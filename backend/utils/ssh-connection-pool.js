const { Client } = require('ssh2');

/**
 * SSH 连接池 - 按主机复用连接；同主机支持多路并发连接
 * Map key -> Array<{ conn, lastUsed, inUse, config }>
 */
class SshConnectionPool {
  constructor() {
    this.connections = new Map();
    this.maxIdleTime = 5 * 60 * 1000;
    this.cleanupInterval = 60 * 1000;
    this.maxPerHost = Math.max(1, parseInt(process.env.SSH_POOL_MAX_PER_HOST || '5', 10) || 5);
    this.waitTimeoutMs = Math.max(1000, parseInt(process.env.SSH_POOL_WAIT_MS || '15000', 10) || 15000);
    this.startCleanup();
  }

  getKey(config) {
    return `${config.ip}:${config.port || 22}:${config.username}`;
  }

  getList(key) {
    let list = this.connections.get(key);
    if (!list) {
      list = [];
      this.connections.set(key, list);
    }
    return list;
  }

  removeEntry(key, conn) {
    const list = this.connections.get(key);
    if (!list) return;
    const next = list.filter((item) => item.conn !== conn);
    if (next.length === 0) this.connections.delete(key);
    else this.connections.set(key, next);
  }

  /**
   * 获取或创建连接（返回具体 conn，释放时必须传回该实例）
   */
  async getConnection(config) {
    const key = this.getKey(config);
    const list = this.getList(key);

    const idle = list.find((item) => !item.inUse && item.conn);
    if (idle) {
      idle.inUse = true;
      idle.lastUsed = Date.now();
      return idle.conn;
    }

    if (list.length < this.maxPerHost) {
      const conn = await this.createConnection(config);
      list.push({
        conn,
        lastUsed: Date.now(),
        inUse: true,
        config
      });
      return conn;
    }

    // 已达上限：等待空闲连接
    const deadline = Date.now() + this.waitTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      const free = list.find((item) => !item.inUse && item.conn);
      if (free) {
        free.inUse = true;
        free.lastUsed = Date.now();
        return free.conn;
      }
    }

    // 等待超时后临时超限建连（用完后若仍超限则直接关闭不入池）
    const conn = await this.createConnection(config);
    list.push({
      conn,
      lastUsed: Date.now(),
      inUse: true,
      config,
      ephemeral: true
    });
    return conn;
  }

  createConnection(config) {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      let settled = false;

      conn.on('ready', () => {
        settled = true;
        resolve(conn);
      });

      conn.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        }
        this.removeEntry(this.getKey(config), conn);
      });

      conn.on('close', () => {
        this.removeEntry(this.getKey(config), conn);
      });

      conn.connect({
        host: config.ip,
        port: config.port || 22,
        username: config.username,
        password: config.password,
        readyTimeout: 10000,
        keepaliveInterval: 30000,
        keepaliveCountMax: 3
      });
    });
  }

  /**
   * 释放连接
   * @param {object} config
   * @param {import('ssh2').Client} [conn] 指定实例；省略时释放该 key 下第一个 inUse（兼容旧调用）
   */
  releaseConnection(config, conn) {
    const key = this.getKey(config);
    const list = this.connections.get(key);
    if (!list || list.length === 0) return;

    const entry = conn
      ? list.find((item) => item.conn === conn)
      : list.find((item) => item.inUse);

    if (!entry) return;

    // 临时超限连接：直接关闭
    if (entry.ephemeral && list.length > this.maxPerHost) {
      try {
        entry.conn.end();
      } catch {
        /* ignore */
      }
      this.removeEntry(key, entry.conn);
      return;
    }

    entry.inUse = false;
    entry.lastUsed = Date.now();
  }

  /**
   * 连接出错时丢弃，避免脏连接回池
   */
  discardConnection(config, conn) {
    if (!conn) return;
    const key = this.getKey(config);
    try {
      conn.end();
    } catch {
      /* ignore */
    }
    this.removeEntry(key, conn);
  }

  /**
   * 执行命令（自动借还连接）
   */
  async exec(config, command, timeout = 30000) {
    let conn;
    let failed = false;
    try {
      conn = await this.getConnection(config);

      return await new Promise((resolve, reject) => {
        let output = '';
        let errorOutput = '';
        let timeoutId = null;

        timeoutId = setTimeout(() => {
          resolve({ success: false, output: `${output.trim()}\n[命令执行超时]`, code: -1 });
        }, timeout);

        try {
          conn.exec(command, (err, stream) => {
            if (err) {
              clearTimeout(timeoutId);
              failed = true;
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
        } catch (err) {
          clearTimeout(timeoutId);
          failed = true;
          reject(err);
        }
      });
    } catch (err) {
      failed = true;
      throw err;
    } finally {
      if (conn) {
        if (failed) this.discardConnection(config, conn);
        else this.releaseConnection(config, conn);
      }
    }
  }

  /**
   * 借用连接做 SFTP 等长操作
   */
  async withConnection(config, fn) {
    let conn;
    let failed = false;
    try {
      conn = await this.getConnection(config);
      return await fn(conn);
    } catch (err) {
      failed = true;
      throw err;
    } finally {
      if (conn) {
        if (failed) this.discardConnection(config, conn);
        else this.releaseConnection(config, conn);
      }
    }
  }

  startCleanup() {
    setInterval(() => {
      const now = Date.now();

      for (const [key, list] of this.connections.entries()) {
        const keep = [];
        for (const cached of list) {
          if (!cached.inUse && now - cached.lastUsed > this.maxIdleTime) {
            try {
              cached.conn.end();
            } catch {
              /* ignore */
            }
            console.log(`[SSH Pool] 清理空闲连接: ${key}`);
          } else {
            keep.push(cached);
          }
        }
        if (keep.length === 0) this.connections.delete(key);
        else this.connections.set(key, keep);
      }
    }, this.cleanupInterval);
  }

  closeAll() {
    for (const list of this.connections.values()) {
      for (const cached of list) {
        try {
          cached.conn.end();
        } catch {
          /* ignore */
        }
      }
    }
    this.connections.clear();
  }

  getStatus() {
    let total = 0;
    let inUse = 0;

    for (const list of this.connections.values()) {
      total += list.length;
      for (const cached of list) {
        if (cached.inUse) inUse += 1;
      }
    }

    return {
      hosts: this.connections.size,
      total,
      inUse,
      idle: total - inUse,
      maxPerHost: this.maxPerHost
    };
  }
}

module.exports = new SshConnectionPool();
