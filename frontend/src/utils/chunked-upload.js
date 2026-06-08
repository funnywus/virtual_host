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
          filename: this.file.name,
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
      this.onProgress({
        uploaded: this.uploadedChunks.length,
        total: this.totalChunks,
        percentage: Math.round((this.uploadedChunks.length / this.totalChunks) * 100)
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
  
  // 合并分片
  async merge() {
    try {
      const res = await fetch(`${API_BASE}/api/upload-chunked/merge-chunks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId: this.uploadId })
      });
      
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}: ${res.statusText}` }));
        throw new Error(data.error || '合并分片失败');
      }
      
      const data = await res.json();
      this.onSuccess(data);
      return data;
    } catch (err) {
      const errorMsg = err.message || '合并分片失败';
      this.onError(new Error(errorMsg));
      throw new Error(errorMsg);
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
          body: JSON.stringify({ uploadId: this.uploadId })
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
