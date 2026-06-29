/**
 * PHP 直传上传工具
 * 浏览器分片直接 POST 到用户站点的 upload.php，一步到位，不经过 Node 中转
 */

const CHUNK_SIZE = 4 * 1024 * 1024; // 每片 4MB
const MAX_CONCURRENT = 3;
const MAX_RETRIES = 3;

export class PhpDirectUploader {
  /**
   * @param {File} file
   * @param {Object} options
   *   - domain: 用户域名（如 sub.example.com）
   *   - token: 签名 token
   *   - expires: token 过期时间戳
   *   - path: 目标子目录（相对站点根）
   *   - onProgress/onSuccess/onError
   */
  constructor(file, options = {}) {
    this.file = file;
    this.domain = options.domain;
    this.token = options.token;
    this.expires = options.expires;
    this.path = options.path || '';
    this.chunkSize = options.chunkSize || CHUNK_SIZE;
    this.maxConcurrent = options.maxConcurrent || MAX_CONCURRENT;

    this.totalChunks = Math.ceil(file.size / this.chunkSize);
    this.uploadedChunks = 0;
    this.uploadedBytes = 0;
    this.totalBytes = file.size;
    // 同协议直传到用户域名，避免 https 页面请求 http 被拦截
    this.uploadUrl = `${window.location.protocol}//${this.domain}/upload.php`;
    this.uploadId = this._genId();
    this.aborted = false;

    this.onProgress = options.onProgress || (() => {});
    this.onSuccess = options.onSuccess || (() => {});
    this.onError = options.onError || (() => {});
  }

  _genId() {
    const arr = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  async uploadChunk(chunkIndex) {
    if (this.aborted) return;

    const start = chunkIndex * this.chunkSize;
    const end = Math.min(start + this.chunkSize, this.file.size);
    const chunk = this.file.slice(start, end);

    const formData = new FormData();
    formData.append('action', 'chunk');
    formData.append('token', this.token);
    formData.append('expires', this.expires);
    formData.append('uploadId', this.uploadId);
    formData.append('index', chunkIndex);
    formData.append('chunk', chunk);

    const res = await fetch(this.uploadUrl, { method: 'POST', body: formData });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(data.error || `分片 ${chunkIndex} 上传失败`);
    }

    this.uploadedChunks++;
    this.uploadedBytes += (end - start);
    this.onProgress({
      uploaded: this.uploadedChunks,
      total: this.totalChunks,
      loadedBytes: this.uploadedBytes,
      totalBytes: this.totalBytes,
      percentage: Math.min(100, Math.round((this.uploadedBytes / this.totalBytes) * 100))
    });
  }

  async uploadAllChunks() {
    const queue = Array.from({ length: this.totalChunks }, (_, i) => i);
    const running = [];

    const uploadWithRetry = async (idx, retries = 0) => {
      try {
        await this.uploadChunk(idx);
      } catch (err) {
        if (retries < MAX_RETRIES && !this.aborted) {
          await new Promise(r => setTimeout(r, 1000));
          return uploadWithRetry(idx, retries + 1);
        }
        throw new Error(`分片 ${idx} 上传失败（已重试 ${MAX_RETRIES} 次）: ${err.message}`);
      }
    };

    while (queue.length > 0 || running.length > 0) {
      if (this.aborted) break;
      while (running.length < this.maxConcurrent && queue.length > 0) {
        const idx = queue.shift();
        const p = uploadWithRetry(idx).then(() => {
          const i = running.indexOf(p);
          if (i > -1) running.splice(i, 1);
        }).catch(err => {
          const i = running.indexOf(p);
          if (i > -1) running.splice(i, 1);
          throw err;
        });
        running.push(p);
      }
      if (running.length > 0) {
        await Promise.race(running);
      }
    }
  }

  async merge() {
    const formData = new FormData();
    formData.append('action', 'merge');
    formData.append('token', this.token);
    formData.append('expires', this.expires);
    formData.append('uploadId', this.uploadId);
    formData.append('total_chunks', this.totalChunks);
    formData.append('filename', this.file.name);
    formData.append('path', this.path);

    const res = await fetch(this.uploadUrl, { method: 'POST', body: formData });
    if (!res.ok) {
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(data.error || '合并失败');
    }
    return res.json();
  }

  async start() {
    try {
      await this.uploadAllChunks();
      if (this.aborted) throw new Error('上传已取消');
      const result = await this.merge();
      this.onSuccess(result);
      return result;
    } catch (err) {
      this.onError(err);
      throw err;
    }
  }

  abort() {
    this.aborted = true;
  }

  // 预检：探测目标站点 upload.php 是否可用（用于决定是否走直传）
  static async probe(domain, timeout = 4000) {
    const url = `${window.location.protocol}//${domain}/upload.php?action=status&uploadId=probecheck0`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      // 不带 token，预期返回 403（说明脚本存在且在运行）
      const res = await fetch(url, { method: 'POST', signal: controller.signal });
      clearTimeout(timer);
      // 403（鉴权失败）或 200 都说明 PHP 脚本存在
      return res.status === 403 || res.status === 200;
    } catch (e) {
      return false;
    }
  }
}

// 大于 5MB 才用直传/分片
export function shouldUseDirectUpload(fileSize) {
  return fileSize > 5 * 1024 * 1024;
}
