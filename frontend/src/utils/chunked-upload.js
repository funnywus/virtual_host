/**
 * 分片上传工具
 * 支持大文件上传、断点续传、并发上传
 */
import { API_BASE } from '@/config';

const CHUNK_SIZE = 2 * 1024 * 1024; // 每片 2MB
const MAX_CONCURRENT = 3; // 最大并发数

export class ChunkedUploader {
  constructor(file, options = {}) {
    this.file = file;
    this.authCode = options.authCode;
    this.path = options.path || '';
    this.chunkSize = options.chunkSize || CHUNK_SIZE;
    this.maxConcurrent = options.maxConcurrent || MAX_CONCURRENT;
    
    this.totalChunks = Math.ceil(file.size / this.chunkSize);
    this.uploadedChunks = [];
    this.uploadedBytes = 0;        // 已成功上传的字节数（用于真实进度和速度）
    this.totalBytes = file.size;   // 文件总字节数
    this.uploadId = null;
    this.aborted = false;
    
    // 回调函数
    this.onProgress = options.onProgress || (() => {});
    this.onSuccess = options.onSuccess || (() => {});
    this.onError = options.onError || (() => {});
  }
  
  // 初始化上传
  async init() {
    try {
      const res = await fetch(`${API_BASE}/api/upload-chunked/init-chunk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auth_code: this.authCode,
          path: this.path,
          filename: (this.file.name || 'file').split(/[/\\]/).pop(),
          total_chunks: this.totalChunks,
          file_size: this.file.size
        })
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}: ${res.statusText}` }));
        throw new Error(data.error || `初始化失败: ${res.status}`);
      }
      
      const data = await res.json();
      this.uploadId = data.uploadId;
      return data;
    } catch (err) {
      const errorMsg = err.message || '初始化上传失败';
      this.onError(new Error(errorMsg));
      throw new Error(errorMsg);
    }
  }
  
  // 上传单个分片
  async uploadChunk(chunkIndex) {
    if (this.aborted) return;
    
    const start = chunkIndex * this.chunkSize;
    const end = Math.min(start + this.chunkSize, this.file.size);
    const chunk = this.file.slice(start, end);
    
    const formData = new FormData();
    formData.append('uploadId', this.uploadId);
    formData.append('chunk_index', chunkIndex);
    formData.append('auth_code', this.authCode || '');
    formData.append('chunk', chunk);
    
    try {
      const res = await fetch(`${API_BASE}/api/upload-chunked/upload-chunk`, {
        method: 'POST',
        body: formData
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}: ${res.statusText}` }));
        throw new Error(data.error || `上传分片 ${chunkIndex} 失败`);
      }
      
      const data = await res.json();
      
      this.uploadedChunks.push(chunkIndex);
      this.uploadedBytes += (end - start);  // 累加该分片实际字节数
      this.onProgress({
        uploaded: this.uploadedChunks.length,
        total: this.totalChunks,
        loadedBytes: this.uploadedBytes,
        totalBytes: this.totalBytes,
        percentage: Math.min(100, Math.round((this.uploadedBytes / this.totalBytes) * 100))
      });
      
      return data;
    } catch (err) {
      throw new Error(`分片 ${chunkIndex} 上传失败: ${err.message}`);
    }
  }
  
  // 并发上传所有分片
  async uploadAllChunks() {
    const chunks = Array.from({ length: this.totalChunks }, (_, i) => i);
    const queue = [...chunks];
    const running = [];
    const maxRetries = 3; // 最大重试次数
    const retryDelay = 1000; // 重试延迟（毫秒）
    
    // 重试函数
    const uploadWithRetry = async (chunkIndex, retries = 0) => {
      try {
        await this.uploadChunk(chunkIndex);
      } catch (err) {
        if (retries < maxRetries) {
          console.log(`分片 ${chunkIndex} 上传失败，${retryDelay}ms 后重试 (${retries + 1}/${maxRetries})...`);
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          return uploadWithRetry(chunkIndex, retries + 1);
        } else {
          throw new Error(`分片 ${chunkIndex} 上传失败（已重试 ${maxRetries} 次）: ${err.message}`);
        }
      }
    };
    
    while (queue.length > 0 || running.length > 0) {
      if (this.aborted) break;
      
      // 填充并发队列
      while (running.length < this.maxConcurrent && queue.length > 0) {
        const chunkIndex = queue.shift();
        const promise = uploadWithRetry(chunkIndex)
          .then(() => {
            const index = running.indexOf(promise);
            if (index > -1) running.splice(index, 1);
          })
          .catch(err => {
            // 失败的分片不再重新加入队列，直接抛出错误
            const index = running.indexOf(promise);
            if (index > -1) running.splice(index, 1);
            throw err;
          });
        
        running.push(promise);
      }
      
      // 等待任意一个完成
      if (running.length > 0) {
        await Promise.race(running);
      }
    }
  }
  
  // 合并分片（异步：发起合并任务后轮询进度，避免长 HTTP 请求被网关超时中断）
  async merge() {
    try {
      // 1. 发起合并任务，立即拿到 taskId
      const res = await fetch(`${API_BASE}/api/upload-chunked/merge-chunks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId: this.uploadId, auth_code: this.authCode })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}: ${res.statusText}` }));
        throw new Error(data.error || '合并分片失败');
      }

      const { taskId } = await res.json();
      if (!taskId) {
        throw new Error('未获取到合并任务ID');
      }

      // 2. 轮询任务状态直到完成或失败
      const result = await this.pollMergeStatus(taskId);
      this.onSuccess(result);
      return result;
    } catch (err) {
      const errorMsg = err.message || '合并分片失败';
      this.onError(new Error(errorMsg));
      throw new Error(errorMsg);
    }
  }

  // 轮询合并上传任务进度
  async pollMergeStatus(taskId) {
    const POLL_INTERVAL = 2000;     // 每 2 秒查询一次
    const MAX_FAILURES = 5;         // 连续查询失败容忍次数（应对短暂网络抖动）
    let consecutiveFailures = 0;

    while (true) {
      if (this.aborted) {
        throw new Error('上传已取消');
      }

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

      let statusRes;
      try {
        const q = this.authCode ? `?auth_code=${encodeURIComponent(this.authCode)}` : '';
        statusRes = await fetch(`${API_BASE}/api/upload-chunked/merge-status/${taskId}${q}`);
      } catch (e) {
        // 网络抖动，重试
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_FAILURES) {
          throw new Error('无法获取合并进度，请检查网络');
        }
        continue;
      }

      if (!statusRes.ok) {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_FAILURES) {
          const data = await statusRes.json().catch(() => ({}));
          throw new Error(data.error || '合并任务已丢失');
        }
        continue;
      }

      consecutiveFailures = 0;
      const status = await statusRes.json();

      // 上报服务器处理进度（合并/上传阶段），phase 标记进入服务器处理
      this.onProgress({
        uploaded: this.totalChunks,
        total: this.totalChunks,
        loadedBytes: this.totalBytes,
        totalBytes: this.totalBytes,
        percentage: 100,
        serverPhase: status.phase,
        serverProgress: status.progress
      });

      if (status.status === 'completed') {
        return { success: true, message: '上传成功' };
      }
      if (status.status === 'error') {
        throw new Error(status.error || '服务器合并上传失败');
      }
      // merging / uploading 继续轮询
    }
  }
  
  // 开始上传
  async start() {
    try {
      await this.init();
      await this.uploadAllChunks();
      
      if (!this.aborted) {
        await this.merge();
      }
    } catch (err) {
      this.onError(err);
      throw err;
    }
  }
  
  // 取消上传
  async abort() {
    this.aborted = true;
    
    if (this.uploadId) {
      try {
        await fetch(`${API_BASE}/api/upload-chunked/cancel-upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uploadId: this.uploadId, auth_code: this.authCode })
        });
      } catch (err) {
        console.error('取消上传失败:', err);
      }
    }
  }
}

// 判断是否使用分片上传（大于 5MB 使用分片）
export function shouldUseChunkedUpload(fileSize) {
  return fileSize > 5 * 1024 * 1024;
}
