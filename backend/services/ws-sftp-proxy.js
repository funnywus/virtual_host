/**
 * WebSocket SFTP 代理服务
 * 允许前端通过 WebSocket 直接上传文件到远程服务器
 */

const WebSocket = require('ws');
const { Client } = require('ssh2');
const crypto = require('crypto');
const path = require('path');

class WebSocketSFTPProxy {
  constructor(server) {
    this.wss = new WebSocket.Server({ 
      server,
      path: '/ws-upload'
    });
    
    this.sessions = new Map(); // 存储活跃的会话
    
    this.wss.on('connection', (ws, req) => {
      const sessionId = crypto.randomBytes(16).toString('hex');
      console.log(`[WS-SFTP] 新连接: ${sessionId}`);
      
      const session = {
        id: sessionId,
        ws,
        sshClient: null,
        sftpStream: null,
        uploadStreams: new Map(),
        connected: false
      };
      
      this.sessions.set(sessionId, session);
      
      ws.on('message', (message) => {
        this.handleMessage(session, message);
      });
      
      ws.on('close', () => {
        console.log(`[WS-SFTP] 连接关闭: ${sessionId}`);
        this.cleanup(session);
        this.sessions.delete(sessionId);
      });
      
      ws.on('error', (error) => {
        console.error(`[WS-SFTP] 错误: ${sessionId}`, error);
        this.cleanup(session);
      });
      
      // 发送会话 ID
      this.sendMessage(ws, {
        type: 'session',
        sessionId
      });
    });
    
    console.log('[WS-SFTP] WebSocket SFTP 代理已启动');
  }
  
  handleMessage(session, message) {
    try {
      const data = JSON.parse(message.toString());
      
      switch (data.type) {
        case 'connect':
          this.handleConnect(session, data);
          break;
          
        case 'upload-start':
          this.handleUploadStart(session, data);
          break;
          
        case 'upload-chunk':
          this.handleUploadChunk(session, data);
          break;
          
        case 'upload-end':
          this.handleUploadEnd(session, data);
          break;
          
        case 'disconnect':
          this.cleanup(session);
          break;
          
        default:
          console.warn(`[WS-SFTP] 未知消息类型: ${data.type}`);
      }
    } catch (err) {
      console.error('[WS-SFTP] 处理消息失败:', err);
      this.sendMessage(session.ws, {
        type: 'error',
        error: err.message
      });
    }
  }
  
  handleConnect(session, data) {
    console.log(`[WS-SFTP] 连接到服务器: ${data.host}:${data.port}`);
    
    const sshClient = new Client();
    session.sshClient = sshClient;
    
    sshClient.on('ready', () => {
      console.log(`[WS-SFTP] SSH 连接成功: ${session.id}`);
      
      sshClient.sftp((err, sftp) => {
        if (err) {
          console.error(`[WS-SFTP] SFTP 初始化失败:`, err);
          this.sendMessage(session.ws, {
            type: 'error',
            error: 'SFTP 初始化失败: ' + err.message
          });
          return;
        }
        
        session.sftpStream = sftp;
        session.connected = true;
        
        console.log(`[WS-SFTP] SFTP 连接成功: ${session.id}`);
        this.sendMessage(session.ws, {
          type: 'connected'
        });
      });
    });
    
    sshClient.on('error', (err) => {
      console.error(`[WS-SFTP] SSH 错误:`, err);
      this.sendMessage(session.ws, {
        type: 'error',
        error: 'SSH 连接失败: ' + err.message
      });
    });
    
    sshClient.connect({
      host: data.host,
      port: data.port || 22,
      username: data.username,
      password: data.password,
      readyTimeout: 30000
    });
  }
  
  handleUploadStart(session, data) {
    if (!session.connected || !session.sftpStream) {
      this.sendMessage(session.ws, {
        type: 'error',
        uploadId: data.uploadId,
        error: '未连接到服务器'
      });
      return;
    }
    
    console.log(`[WS-SFTP] 开始上传: ${data.remotePath}`);
    
    try {
      // 确保目录存在
      const dir = path.dirname(data.remotePath);
      session.sftpStream.mkdir(dir, { recursive: true }, (err) => {
        if (err && err.code !== 4) { // 4 = 文件已存在
          console.error(`[WS-SFTP] 创建目录失败:`, err);
        }
        
        // 创建写入流
        const writeStream = session.sftpStream.createWriteStream(data.remotePath, {
          flags: 'w',
          mode: 0o644
        });
        
        session.uploadStreams.set(data.uploadId, {
          stream: writeStream,
          remotePath: data.remotePath,
          bytesWritten: 0,
          totalSize: data.fileSize
        });
        
        writeStream.on('error', (err) => {
          console.error(`[WS-SFTP] 写入错误:`, err);
          this.sendMessage(session.ws, {
            type: 'upload-error',
            uploadId: data.uploadId,
            error: err.message
          });
          session.uploadStreams.delete(data.uploadId);
        });
        
        this.sendMessage(session.ws, {
          type: 'upload-ready',
          uploadId: data.uploadId
        });
      });
    } catch (err) {
      console.error(`[WS-SFTP] 上传启动失败:`, err);
      this.sendMessage(session.ws, {
        type: 'error',
        uploadId: data.uploadId,
        error: err.message
      });
    }
  }
  
  handleUploadChunk(session, data) {
    const upload = session.uploadStreams.get(data.uploadId);
    
    if (!upload) {
      this.sendMessage(session.ws, {
        type: 'error',
        uploadId: data.uploadId,
        error: '上传会话不存在'
      });
      return;
    }
    
    try {
      // 将 base64 转换为 Buffer
      const buffer = Buffer.from(data.chunk, 'base64');
      
      // 写入数据
      const canContinue = upload.stream.write(buffer);
      upload.bytesWritten += buffer.length;
      
      const progress = Math.round((upload.bytesWritten / upload.totalSize) * 100);
      
      this.sendMessage(session.ws, {
        type: 'upload-progress',
        uploadId: data.uploadId,
        bytesWritten: upload.bytesWritten,
        totalSize: upload.totalSize,
        progress
      });
      
      if (!canContinue) {
        // 等待 drain 事件
        upload.stream.once('drain', () => {
          this.sendMessage(session.ws, {
            type: 'upload-continue',
            uploadId: data.uploadId
          });
        });
      } else {
        this.sendMessage(session.ws, {
          type: 'upload-continue',
          uploadId: data.uploadId
        });
      }
    } catch (err) {
      console.error(`[WS-SFTP] 写入分片失败:`, err);
      this.sendMessage(session.ws, {
        type: 'upload-error',
        uploadId: data.uploadId,
        error: err.message
      });
    }
  }
  
  handleUploadEnd(session, data) {
    const upload = session.uploadStreams.get(data.uploadId);
    
    if (!upload) {
      this.sendMessage(session.ws, {
        type: 'error',
        uploadId: data.uploadId,
        error: '上传会话不存在'
      });
      return;
    }
    
    upload.stream.end(() => {
      console.log(`[WS-SFTP] 上传完成: ${upload.remotePath}`);
      
      // 设置权限
      session.sftpStream.chmod(upload.remotePath, 0o644, (err) => {
        if (err) {
          console.error(`[WS-SFTP] 设置权限失败:`, err);
        }
        
        this.sendMessage(session.ws, {
          type: 'upload-complete',
          uploadId: data.uploadId,
          remotePath: upload.remotePath
        });
        
        session.uploadStreams.delete(data.uploadId);
      });
    });
  }
  
  cleanup(session) {
    console.log(`[WS-SFTP] 清理会话: ${session.id}`);
    
    // 关闭所有上传流
    for (const [uploadId, upload] of session.uploadStreams) {
      try {
        upload.stream.end();
      } catch (err) {
        console.error(`[WS-SFTP] 关闭上传流失败:`, err);
      }
    }
    session.uploadStreams.clear();
    
    // 关闭 SSH 连接
    if (session.sshClient) {
      try {
        session.sshClient.end();
      } catch (err) {
        console.error(`[WS-SFTP] 关闭 SSH 连接失败:`, err);
      }
    }
    
    session.connected = false;
  }
  
  sendMessage(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }
}

module.exports = WebSocketSFTPProxy;
