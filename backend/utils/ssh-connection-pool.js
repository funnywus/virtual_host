const { Client } = require('ssh2');

/**
 * SSH 连接池 - 复用 SSH 连接以提升性能
 */
class SshConnectionPool {
  constructor() {
    this.connections = new Map(); // key: "ip:port:username", value: { conn, lastUsed, inUse }
    this.maxIdleTime = 5 * 60 * 1000; // 5分钟空闲后关闭连接
    this.cleanupInterval = 60 * 1000; // 每分钟清理一次
    
    // 启动定期清理
    this.startCleanup();
  }

  /**
   * 获取连接键
   */
  getKey(config) {
    return `${config.ip}:${config.port || 22}:${config.username}`;
  }

  /**
   * 获取或创建连接
   */
  async getConnection(config) {
    const key = this.getKey(config);
    const cached = this.connections.get(key);

    // 如果有缓存的连接且未被使用，复用它
    if (cached && !cached.inUse) {
      cached.inUse = true;
      cached.lastUsed = Date.now();
      return cached.conn;
    }

    // 创建新连接
    const conn = await this.createConnection(config);
    
    this.connections.set(key, {
      conn,
      lastUsed: Date.now(),
      inUse: true,
      config
    });

    return conn;
  }

  /**
   * 创建新的 SSH 连接
   */
  createConnection(config) {
    return new Promise((resolve, reject) => {
      const conn = new Client();

      conn.on('ready', () => {
        resolve(conn);
      });

      conn.on('error', (err) => {
        reject(err);
      });

      conn.on('close', () => {
        // 连接关闭时从池中移除
        const key = this.getKey(config);
        this.connections.delete(key);
      });

      conn.connect({
        host: config.ip,
        port: config.port || 22,
        username: config.username,
        password: config.password,
        readyTimeout: 10000,
        keepaliveInterval: 30000, // 保持连接活跃
        keepaliveCountMax: 3
      });
    });
  }

  /**
   * 释放连接（标记为可复用）
   */
  releaseConnection(config) {
    const key = this.getKey(config);
    const cached = this.connections.get(key);
    
    if (cached) {
      cached.inUse = false;
      cached.lastUsed = Date.now();
    }
  }

  /**
   * 执行命令（自动管理连接）
   */
  async exec(config, command, timeout = 30000) {
    let conn;
    try {
      conn = await this.getConnection(config);
      
      return await new Promise((resolve, reject) => {
        let output = '';
        let errorOutput = '';
        let timeoutId = null;

        timeoutId = setTimeout(() => {
          resolve({ success: false, output: output.trim() + '\n[命令执行超时]', code: -1 });
        }, timeout);

        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timeoutId);
            return reject(err);
          }

          stream.on('close', (code) => {
            clearTimeout(timeoutId);
            if (code === 0) {
              resolve({ success: true, output: output.trim() });
            } else {
              resolve({ success: false, output: errorOutput.trim() || output.trim(), code });
            }
          });

          stream.on('data', (data) => {
            output += data.toString();
          });

          stream.stderr.on('data', (data) => {
            errorOutput += data.toString();
            output += data.toString();
          });
        });
      });
    } finally {
      // 释放连接供下次使用
      if (conn) {
        this.releaseConnection(config);
      }
    }
  }

  /**
   * 定期清理空闲连接
   */
  startCleanup() {
    setInterval(() => {
      const now = Date.now();
      
      for (const [key, cached] of this.connections.entries()) {
        // 如果连接空闲超过最大空闲时间，关闭它
        if (!cached.inUse && (now - cached.lastUsed) > this.maxIdleTime) {
          try {
            cached.conn.end();
          } catch (err) {
            // 忽略关闭错误
          }
          this.connections.delete(key);
          console.log(`[SSH Pool] 清理空闲连接: ${key}`);
        }
      }
    }, this.cleanupInterval);
  }

  /**
   * 关闭所有连接
   */
  closeAll() {
    for (const [key, cached] of this.connections.entries()) {
      try {
        cached.conn.end();
      } catch (err) {
        // 忽略关闭错误
      }
    }
    this.connections.clear();
  }

  /**
   * 获取连接池状态
   */
  getStatus() {
    const total = this.connections.size;
    let inUse = 0;
    
    for (const cached of this.connections.values()) {
      if (cached.inUse) inUse++;
    }
    
    return {
      total,
      inUse,
      idle: total - inUse
    };
  }
}

// 导出单例
module.exports = new SshConnectionPool();
