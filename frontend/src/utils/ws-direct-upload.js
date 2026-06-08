/**
 * WebSocket 直传上传工具
 * 通过 WebSocket 代理实现接近直连的上传速度
 */
import { WS_BASE } from '@/config';

const CHUNK_SIZE = 512 * 1024; // 每片 512KB（WebSocket 适合较小的分片）

export class WebSocketDirectUploader {
  constructor(config) {
    this.config = config;
    this.ws = null;
    this.sessionId = null;
    this.connected = false;
    this.uploadQueue = [];
    this.currentUpload = null;
    
    // 回调函数
    this.onProgress = config.onProgress || (() => {});
    this.onSuccess = config.onSuccess || (() => {});
    this.onError = config.onError || (() => {});
  }
  
  // 连接到 WebSocket 服务器
  async connect() {
    return new Promise((resolve, reject) => {
      // 使用配置的 WS 地址，自动适配开发和生产环境
      const wsUrl = `${WS_BASE}/ws-upload`;
      console.log(`[WS直传] 连接到: ${wsUrl}`);
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        console.log('[WS直传] WebSocket 连接已建立');
      };
      
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data, resolve, reject);
        } catch (err) {
          console.error('[WS直传] 解析消息失败:', err);
        }
      };
      
      this.ws.onerror = (error) => {
        console.error('[WS直传] WebSocket 错误:', error);
        reject(new Error('WebSocket 连接失败'));
      };
      
      this.ws.onclose = () => {
        console.log('[WS直传] WebSocket 连接已关闭');
        this.connected = false;
      };
    });
  }
  
  handleMessage(data, connectResolve, connectReject) {
    switch (data.type) {
      case 'session':
        this.sessionId = data.sessionId;
        console.log(`[WS直传] 会话 ID: ${this.sessionId}`);
        // 发送连接请求
        this.sendMessage({
          type: 'connect',
          host: this.config.host,
          port: this.config.port || 22,
          username: this.config.username,
          password: this.config.password
        });
        break;
        
      case 'connected':
        console.log('[WS直传] SFTP 连接成功');
        this.connected = true;
        if (connectResolve) connectResolve();
        break;
        
      case 'upload-ready':
        console.log(`[WS直传] 上传就绪: ${data.uploadId}`);
        if (this.currentUpload && this.currentUpload.uploadId === data.uploadId) {
          this.uploadNextChunk();
        }
        break;
        
      case 'upload-progress':
        if (this.currentUpload && this.currentUpload.uploadId === data.uploadId) {
          this.onProgress({
            uploadId: data.uploadId,
            bytesWritten: data.bytesWritten,
            totalSize: data.totalSize,
            progress: data.progress
          });
        }
        break;
        
      case 'upload-continue':
        if (this.currentUpload && this.currentUpload.uploadId === data.uploadId) {
          this.uploadNextChunk();
        }
        break;
        
      case 'upload-complete':
        console.log(`[WS直传] 上传完成: ${data.remotePath}`);
        if (this.currentUpload && this.currentUpload.uploadId === data.uploadId) {
          const currentUpload = this.currentUpload;
          this.onSuccess({
            uploadId: data.uploadId,
            remotePath: data.remotePath
          });
          this.currentUpload = null;
          // 解析 Promise，让 await uploadFile() 完成
          currentUpload.resolve({
            uploadId: data.uploadId,
            remotePath: data.remotePath
          });
          this.processNextUpload();
        }
        break;
        
      case 'upload-error':
      case 'error':
        console.error(`[WS直传] 错误:`, data.error);
        const error = new Error(data.error);
        if (this.currentUpload && data.uploadId === this.currentUpload.uploadId) {
          const currentUpload = this.currentUpload;
          this.onError(error);
          this.currentUpload = null;
          // 拒绝 Promise，让 await uploadFile() 抛出错误
          currentUpload.reject(error);
        }
        if (connectReject) connectReject(error);
        break;
    }
  }
  
  // 上传文件
  async uploadFile(file, remotePath) {
    if (!this.connected) {
      throw new Error('未连接到服务器');
    }
    
    const uploadId = Math.random().toString(36).substring(7);
    
    return new Promise((resolve, reject) => {
      const upload = {
        uploadId,
        file,
        remotePath,
        currentChunk: 0,
        totalChunks: Math.ceil(file.size / CHUNK_SIZE),
        resolve,
        reject
      };
      
      this.uploadQueue.push(upload);
      
      if (!this.currentUpload) {
        this.processNextUpload();
      }
    });
  }
  
  processNextUpload() {
    if (this.uploadQueue.length === 0) {
      return;
    }
    
    this.currentUpload = this.uploadQueue.shift();
    console.log(`[WS直传] 开始上传: ${this.currentUpload.remotePath}`);
    
    // 发送上传开始消息
    this.sendMessage({
      type: 'upload-start',
      uploadId: this.currentUpload.uploadId,
      remotePath: this.currentUpload.remotePath,
      fileSize: this.currentUpload.file.size
    });
  }
  
  async uploadNextChunk() {
    if (!this.currentUpload) return;
    
    const { file, currentChunk, totalChunks, uploadId } = this.currentUpload;
    
    if (currentChunk >= totalChunks) {
      // 所有分片已上传，发送结束消息
      this.sendMessage({
        type: 'upload-end',
        uploadId
      });
      return;
    }
    
    const start = currentChunk * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    
    // 读取分片并转换为 base64
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(',')[1];
      
      this.sendMessage({
        type: 'upload-chunk',
        uploadId,
        chunk: base64
      });
      
      this.currentUpload.currentChunk++;
    };
    
    reader.onerror = () => {
      const error = new Error('读取文件失败');
      this.onError(error);
      if (this.currentUpload) {
        this.currentUpload.reject(error);
        this.currentUpload = null;
      }
    };
    
    reader.readAsDataURL(chunk);
  }
  
  sendMessage(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
  
  // 断开连接
  disconnect() {
    if (this.ws) {
      this.sendMessage({ type: 'disconnect' });
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.sessionId = null;
  }
}

// 判断是否支持 WebSocket 直传
export function supportsWebSocketUpload() {
  return typeof WebSocket !== 'undefined';
}
