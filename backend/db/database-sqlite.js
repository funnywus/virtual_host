const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DB_PATH || './data/app.db';
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

const init = () => {
  db.serialize(() => {
    // 用户表
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 服务器表
    db.run(`
      CREATE TABLE IF NOT EXISTS servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        ip TEXT NOT NULL,
        port INTEGER DEFAULT 22,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // 虚拟主机表
    db.run(`
      CREATE TABLE IF NOT EXISTS virtual_hosts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT UNIQUE NOT NULL,
        server_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        ftp_username TEXT,
        ftp_password TEXT,
        ftp_port INTEGER DEFAULT 21,
        dns_status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(server_id) REFERENCES servers(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // DNS记录表
    db.run(`
      CREATE TABLE IF NOT EXISTS dns_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        virtual_host_id INTEGER NOT NULL,
        record_type TEXT NOT NULL,
        record_value TEXT NOT NULL,
        ttl INTEGER DEFAULT 600,
        aliyun_record_id TEXT,
        status TEXT DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(virtual_host_id) REFERENCES virtual_hosts(id)
      )
    `);

    // DNS平台配置表（支持多个厂商：阿里云、腾讯云、Cloudflare等）
    db.run(`
      CREATE TABLE IF NOT EXISTS aliyun_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        platform TEXT DEFAULT 'aliyun',
        access_key TEXT NOT NULL,
        secret_key TEXT NOT NULL,
        remark TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // 主域名表
    db.run(`
      CREATE TABLE IF NOT EXISTS domains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT UNIQUE NOT NULL,
        user_id INTEGER NOT NULL,
        aliyun_config_id INTEGER,
        status TEXT DEFAULT 'active',
        ssl_status TEXT DEFAULT 'none',
        ssl_type TEXT,
        ssl_expires TEXT,
        ssl_log TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(aliyun_config_id) REFERENCES aliyun_config(id)
      )
    `);

    // 子域名表
    db.run(`
      CREATE TABLE IF NOT EXISTS subdomains (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain_id INTEGER NOT NULL,
        subdomain TEXT NOT NULL,
        server_id INTEGER,
        record_type TEXT DEFAULT 'A',
        record_value TEXT,
        ttl INTEGER DEFAULT 600,
        aliyun_record_id TEXT,
        status TEXT DEFAULT 'pending',
        nginx_config TEXT,
        nginx_synced INTEGER DEFAULT 0,
        ssl_status TEXT DEFAULT 'none',
        ssl_type TEXT,
        ssl_expires TEXT,
        rate_limit_enabled INTEGER DEFAULT 0,
        rate_limit_rate TEXT DEFAULT '10r/s',
        rate_limit_burst INTEGER DEFAULT 20,
        rate_limit_nodelay INTEGER DEFAULT 1,
        rate_limit_conn INTEGER DEFAULT 10,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(domain_id) REFERENCES domains(id),
        FOREIGN KEY(server_id) REFERENCES servers(id),
        UNIQUE(domain_id, subdomain)
      )
    `);

    // 服务器标签表
    db.run(`
      CREATE TABLE IF NOT EXISTS server_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        color TEXT DEFAULT '',
        user_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);

    // FTP账号表
    db.run(`
      CREATE TABLE IF NOT EXISTS ftp_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subdomain_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        port INTEGER DEFAULT 21,
        home_dir TEXT,
        auth_code TEXT,
        max_upload_size INTEGER DEFAULT 524288000,
        status TEXT DEFAULT 'active',
        sync_status TEXT DEFAULT 'pending',
        sync_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(subdomain_id) REFERENCES subdomains(id)
      )
    `);

    // 数据库迁移 - 添加缺失的列
    db.run(`ALTER TABLE subdomains ADD COLUMN ssl_status TEXT DEFAULT 'none'`, () => {});
    db.run(`ALTER TABLE subdomains ADD COLUMN ssl_type TEXT`, () => {});
    db.run(`ALTER TABLE subdomains ADD COLUMN ssl_expires TEXT`, () => {});
    db.run(`ALTER TABLE ftp_accounts ADD COLUMN max_upload_size INTEGER DEFAULT 524288000`, () => {});
    db.run(`ALTER TABLE domains ADD COLUMN ssl_status TEXT DEFAULT 'none'`, () => {});
    db.run(`ALTER TABLE domains ADD COLUMN ssl_type TEXT`, () => {});
    db.run(`ALTER TABLE domains ADD COLUMN ssl_expires TEXT`, () => {});
    db.run(`ALTER TABLE domains ADD COLUMN ssl_log TEXT`, () => {});
    db.run(`ALTER TABLE aliyun_config ADD COLUMN platform TEXT DEFAULT 'aliyun'`, () => {});
    db.run(`ALTER TABLE servers ADD COLUMN tags TEXT`, () => {});
    db.run(`ALTER TABLE servers ADD COLUMN status TEXT DEFAULT 'active'`, () => {});
    db.run(`ALTER TABLE domains ADD COLUMN tags TEXT`, () => {});
    db.run(`ALTER TABLE aliyun_config ADD COLUMN tags TEXT`, () => {});
    // 子域名状态和包年包月
    db.run(`ALTER TABLE subdomains ADD COLUMN use_status TEXT DEFAULT 'unused'`, () => {}); // unused/used/disabled
    db.run(`ALTER TABLE subdomains ADD COLUMN expire_at TEXT`, () => {}); // 到期时间
    db.run(`ALTER TABLE subdomains ADD COLUMN duration_months INTEGER`, () => {}); // 购买时长(月)
    db.run(`ALTER TABLE subdomains ADD COLUMN duration_days INTEGER DEFAULT 31`, () => {}); // 有效期天数
    db.run(`ALTER TABLE subdomains ADD COLUMN activated_at TEXT`, () => {}); // 首次激活时间（用户首次登录）
    db.run(`ALTER TABLE subdomains ADD COLUMN remark TEXT`, () => {}); // 备注
    // 默认配置
    db.run(`ALTER TABLE servers ADD COLUMN is_default INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE servers ADD COLUMN nginx_path TEXT DEFAULT '/www/server/panel/vhost/nginx'`, () => {});
    db.run(`ALTER TABLE servers ADD COLUMN ftp_path TEXT DEFAULT '/www/wwwroot/ftp'`, () => {});
    db.run(`ALTER TABLE domains ADD COLUMN is_default INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE aliyun_config ADD COLUMN is_default INTEGER DEFAULT 0`, () => {});
    db.run(`ALTER TABLE server_tags ADD COLUMN is_default INTEGER DEFAULT 0`, () => {});

    // 批量SSL证书任务表
    db.run(`
      CREATE TABLE IF NOT EXISTS batch_ssl_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT UNIQUE NOT NULL,
        user_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        total INTEGER DEFAULT 0,
        done INTEGER DEFAULT 0,
        success INTEGER DEFAULT 0,
        failed INTEGER DEFAULT 0,
        log TEXT,
        results TEXT,
        cert_type TEXT DEFAULT 'letsencrypt',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME,
        finished_at DATETIME,
        FOREIGN KEY(user_id) REFERENCES users(id)
      )
    `);
  });
};

module.exports = {
  db,
  init,
  run: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve(this);
      });
    });
  },
  get: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  all: (sql, params = []) => {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
};
