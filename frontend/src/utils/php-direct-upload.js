/**
 * PHP 直传上传工具
 * 浏览器分片直接 POST 到用户站点的 upload.php，一步到位，不经过 Node 中转
 */

const CHUNK_SIZE = 4 * 1024 * 1024; // 每片 4MB
const MAX_CONCURRENT = 3;
const MAX_RETRIES = 3;
const DEFAULT_UPLOAD_PATH = '/_vhost/upload.php';
const LEGACY_UPLOAD_PATH = '/upload.php';

export class PhpDirectUploader {
  constructor(file, options = {}) {
    this.file = file;
    this.domain = options.domain;
    this.token = options.token;
    this.expires = options.expires;
    this.path = options.path || '';
    this.chunkSize = options.chunkSize || CHUNK_SIZE;
    this.maxConcurrent = options.maxConcurrent || MAX_CONCURRENT;
    this.uploadPath = options.uploadPath || DEFAULT_UPLOAD_PATH;

    this.totalChunks = Math.ceil(file.size / this.chunkSize);
    this.uploadId = this._genId();
    this.aborted = false;

    // 已完成字节 + 各分片进行中的已发送字节（并发时用于准确进度/网速）
    this.completedBytes = 0;
    this.inFlightBytes = new Map();
    this.totalBytes = file.size;

    this.uploadUrl = `https://${this.domain}${this.uploadPath}`;

    this.onProgress = options.onProgress || (() => {});
    this.onSuccess = options.onSuccess || (() => {});
    this.onError = options.onError || (() => {});
  }

  _genId() {
    const arr = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  _emitProgress() {
    let inFlight = 0;
    for (const n of this.inFlightBytes.values()) inFlight += n;
    const loadedBytes = Math.min(this.totalBytes, this.completedBytes + inFlight);
    this.onProgress({
      uploaded: Math.ceil(loadedBytes / this.chunkSize),
      total: this.totalChunks,
      loadedBytes,
      totalBytes: this.totalBytes,
      percentage: Math.min(100, Math.round((loadedBytes / this.totalBytes) * 100))
    });
  }

  _postForm(formData, trackKey, trackBytes) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', this.uploadUrl);

      if (trackBytes > 0) {
        xhr.upload.onprogress = (e) => {
          if (this.aborted) return;
          const sent = e.lengthComputable ? e.loaded : 0;
          this.inFlightBytes.set(trackKey, Math.min(sent, trackBytes));
          this._emitProgress();
        };
      }

      xhr.onload = () => {
        if (trackBytes > 0) this.inFlightBytes.delete(trackKey);
        if (xhr.status >= 200 && xhr.status < 300) {
          let data = null;
          try {
            data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
          } catch (_) { /* ignore */ }
          resolve(data);
          return;
        }
        let msg = `HTTP ${xhr.status}`;
        try {
          const data = JSON.parse(xhr.responseText);
          msg = data.error || msg;
        } catch (_) { /* ignore */ }
        reject(new Error(msg));
      };

      xhr.onerror = () => reject(new Error('网络错误'));
      xhr.onabort = () => reject(new Error('上传已取消'));

      if (this.aborted) {
        xhr.abort();
        reject(new Error('上传已取消'));
        return;
      }

      xhr.send(formData);
      this._activeXhrs = this._activeXhrs || new Set();
      this._activeXhrs.add(xhr);
      xhr.addEventListener('loadend', () => this._activeXhrs?.delete(xhr));
    });
  }

  async uploadChunk(chunkIndex) {
    if (this.aborted) return;

    const start = chunkIndex * this.chunkSize;
    const end = Math.min(start + this.chunkSize, this.file.size);
    const chunkBytes = end - start;
    const chunk = this.file.slice(start, end);

    const formData = new FormData();
    formData.append('action', 'chunk');
    formData.append('token', this.token);
    formData.append('expires', this.expires);
    formData.append('uploadId', this.uploadId);
    formData.append('index', chunkIndex);
    formData.append('chunk', chunk);

    this.inFlightBytes.set(chunkIndex, 0);
    await this._postForm(formData, chunkIndex, chunkBytes);
    this.completedBytes += chunkBytes;
    this._emitProgress();
  }

  async uploadAllChunks() {
    const queue = Array.from({ length: this.totalChunks }, (_, i) => i);
    const running = [];

    const uploadWithRetry = async (idx, retries = 0) => {
      try {
        await this.uploadChunk(idx);
      } catch (err) {
        this.inFlightBytes.delete(idx);
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

    const data = await this._postForm(formData, 'merge', 0);
    return data || { success: true, filename: this.file.name, size: this.file.size };
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
    if (this._activeXhrs) {
      for (const xhr of this._activeXhrs) xhr.abort();
    }
  }

  static async probe(domain, timeout = 4000, preferredPath) {
    // 优先探测指定路径，再回退其他已知路径（避免只配置了 _vhost 但站点仍是旧版时 probe 失败）
    const paths = [...new Set([preferredPath, DEFAULT_UPLOAD_PATH, LEGACY_UPLOAD_PATH].filter(Boolean))];
    for (const p of paths) {
      const url = `https://${domain}${p}?action=status&uploadId=probecheck0`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        const res = await fetch(url, { method: 'POST', signal: controller.signal });
        clearTimeout(timer);
        if (res.status === 403 || res.status === 200) {
          console.log('[直传] probe 成功:', p, 'status:', res.status);
          return p;
        }
        console.log('[直传] probe 不可用:', p, 'status:', res.status);
      } catch (e) {
        console.log('[直传] probe 失败:', p, e.message);
      }
    }
    return false;
  }
}

export function shouldUseDirectUpload(fileSize) {
  return fileSize > 5 * 1024 * 1024;
}
