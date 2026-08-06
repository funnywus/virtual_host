/**
 * WebSocket SFTP 代理服务
 * 前端仅凭授权码建连；SSH 凭据由服务端按账号解析，禁止任意 host/password 中继。
 */

const WebSocket = require('ws');
const { Client } = require('ssh2');
const crypto = require('crypto');
const path = require('path');
const { findFtpByAuthCode, isPathInsideHome } = require('./ftp-lookup');

class WebSocketSFTPProxy {
  constructor(server) {
    this.wss = new WebSocket.Server({
      server,
      path: '/ws-upload'
    });

    this.sessions = new Map();

    this.wss.on('connection', (ws) => {
      const sessionId = crypto.randomBytes(16).toString('hex');
      console.log(`[WS-SFTP] 新连接: ${sessionId}`);

      const session = {
        id: sessionId,
        ws,
        sshClient: null,
        sftpStream: null,
        uploadStreams: new Map(),
        connected: false,
        homeDir: null,
        ftpId: null
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

      this.sendMessage(ws, {
        type: 'session',
        sessionId
      });
    });

    console.log('[WS-SFTP] WebSocket SFTP 代理已启动（需授权码）');
  }

  handleMessage(session, message) {
    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case 'connect':
          this.handleConnect(session, data).catch((err) => {
            console.error(`[WS-SFTP] 连接失败: ${session.id}`, err.message);
            this.sendMessage(session.ws, {
              type: 'error',
              error: err.message || '连接失败'
            });
          });
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

  async handleConnect(session, data) {
    if (data.host || data.password || data.username) {
      throw new Error('已禁用凭据直连，请使用授权码连接');
    }

    const authCode = String(data.auth_code || '').trim();
    if (!authCode) {
      throw new Error('缺少授权码');
    }

    const ftp = await findFtpByAuthCode(authCode);
    if (!ftp || !ftp.ip) {
      throw new Error('授权码无效或服务器未配置');
    }
    if (!ftp.ssh_user || !ftp.ssh_pass) {
      throw new Error('服务器 SSH 凭据未配置');
    }

    if (session.sshClient) {
      try { session.sshClient.end(); } catch { /* ignore */ }
      session.sshClient = null;
      session.sftpStream = null;
      session.connected = false;
    }

    console.log(`[WS-SFTP] 授权码建连: ${ftp.full_domain} -> ${ftp.ip}:${ftp.ssh_port || 22}`);

    await new Promise((resolve, reject) => {
      const sshClient = new Client();
      session.sshClient = sshClient;

      sshClient.on('ready', () => {
        console.log(`[WS-SFTP] SSH 连接成功: ${session.id}`);

        sshClient.sftp((err, sftp) => {
          if (err) {
            reject(new Error('SFTP 初始化失败: ' + err.message));
            return;
          }

          session.sftpStream = sftp;
          session.connected = true;
          session.homeDir = ftp.home_dir;
          session.ftpId = ftp.id;

          console.log(`[WS-SFTP] SFTP 连接成功: ${session.id}`);
          this.sendMessage(session.ws, { type: 'connected' });
          resolve();
        });
      });

      sshClient.on('error', (err) => {
        reject(new Error('SSH 连接失败: ' + err.message));
      });

      sshClient.connect({
        host: ftp.ip,
        port: ftp.ssh_port || 22,
        username: ftp.ssh_user,
        password: ftp.ssh_pass,
        readyTimeout: 30000
      });
    });
  }

  resolveRemotePath(session, remotePath) {
    const raw = String(remotePath || '').replace(/\\/g, '/');
    if (!raw || raw.includes('..')) {
      throw new Error('非法远程路径');
    }

    const abs = path.posix.isAbsolute(raw)
      ? path.posix.normalize(raw)
      : path.posix.join(session.homeDir || '', raw.replace(/^\/+/, ''));

    if (!isPathInsideHome(abs, session.homeDir)) {
      throw new Error('无权写入该路径');
    }
    return abs;
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

    let remotePath;
    try {
      remotePath = this.resolveRemotePath(session, data.remotePath);
    } catch (err) {
      this.sendMessage(session.ws, {
        type: 'upload-error',
        uploadId: data.uploadId,
        error: err.message
      });
      return;
    }

    console.log(`[WS-SFTP] 开始上传: ${remotePath}`);

    try {
      const dir = path.posix.dirname(remotePath);
      session.sftpStream.mkdir(dir, { recursive: true }, (err) => {
        if (err && err.code !== 4) {
          console.error(`[WS-SFTP] 创建目录失败:`, err);
        }

        const writeStream = session.sftpStream.createWriteStream(remotePath, {
          flags: 'w',
          mode: 0o644
        });

        session.uploadStreams.set(data.uploadId, {
          stream: writeStream,
          remotePath,
          bytesWritten: 0,
          totalSize: data.fileSize
        });

        writeStream.on('error', (writeErr) => {
          console.error(`[WS-SFTP] 写入错误:`, writeErr);
          this.sendMessage(session.ws, {
            type: 'upload-error',
            uploadId: data.uploadId,
            error: writeErr.message
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
      const buffer = Buffer.from(data.chunk, 'base64');
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

    for (const [, upload] of session.uploadStreams) {
      try {
        upload.stream.end();
      } catch (err) {
        console.error(`[WS-SFTP] 关闭上传流失败:`, err);
      }
    }
    session.uploadStreams.clear();

    if (session.sshClient) {
      try {
        session.sshClient.end();
      } catch (err) {
        console.error(`[WS-SFTP] 关闭 SSH 连接失败:`, err);
      }
    }

    session.connected = false;
    session.homeDir = null;
    session.ftpId = null;
  }

  sendMessage(ws, data) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }
}

module.exports = WebSocketSFTPProxy;
