const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');
require('dotenv').config();

const db = require('./db/database');
const authRoutes = require('./routes/auth');
const serverRoutes = require('./routes/servers');
const dnsRoutes = require('./routes/dns');
const userRoutes = require('./routes/users');
const ftpRoutes = require('./routes/ftp');
const nginxRoutes = require('./routes/nginx');
const uploadRoutes = require('./routes/upload');
const uploadChunkedRoutes = require('./routes/upload-chunked');
const sslRoutes = require('./routes/ssl');
const tagsRoutes = require('./routes/tags');
const systemRoutes = require('./routes/system');
const WebSocketSFTPProxy = require('./services/ws-sftp-proxy');
const { initSslLogWebSocket } = require('./services/ssl-log-ws');

// 格式化时间为 YYYY-MM-DD HH:mm:ss
const formatTime = (date = new Date()) => {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

const app = express();

app.use(cors());
app.use(bodyParser.json({ limit: '500mb' }));
app.use(bodyParser.urlencoded({ limit: '500mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 设置超时时间为 30 分钟（支持大文件上传和合并）
app.use((req, res, next) => {
  req.setTimeout(1800000); // 30 分钟
  res.setTimeout(1800000);
  next();
});

// 初始化数据库
db.init();

const getTableColumns = async (tableName) => {
  if (db.type === 'mysql') {
    const rows = await db.all(`SHOW COLUMNS FROM ${tableName}`);
    return rows.map(row => ({ name: row.Field }));
  }
  return await db.all(`PRAGMA table_info(${tableName})`);
};

// 数据库迁移：补充新增字段
async function migrateDatabase() {
  try {
    // 检查 domains 表是否已有 expire_at 字段
    const domainsColumns = await getTableColumns('domains');
    const hasDomainsExpireAt = domainsColumns.some(col => col.name === 'expire_at');
    
    if (!hasDomainsExpireAt) {
      console.log('[DB Migration] 为 domains 表添加 expire_at 字段...');
      await db.run('ALTER TABLE domains ADD COLUMN expire_at DATETIME DEFAULT NULL');
      console.log('[DB Migration] ✓ domains 表添加成功');
    }
    
    // 检查 servers 表是否已有 expire_at 字段
    const serversColumns = await getTableColumns('servers');
    const hasServersExpireAt = serversColumns.some(col => col.name === 'expire_at');
    const hasServersStatus = serversColumns.some(col => col.name === 'status');
    
    if (!hasServersExpireAt) {
      console.log('[DB Migration] 为 servers 表添加 expire_at 字段...');
      await db.run('ALTER TABLE servers ADD COLUMN expire_at DATETIME DEFAULT NULL');
      console.log('[DB Migration] ✓ servers 表添加成功');
    }

    if (!hasServersStatus) {
      console.log('[DB Migration] 为 servers 表添加 status 字段...');
      await db.run("ALTER TABLE servers ADD COLUMN status VARCHAR(20) DEFAULT 'active'");
      console.log('[DB Migration] ✓ servers.status 添加成功');
    }
    
    // 检查并创建 batch_ssl_jobs 表
    const batchJobsTableExists = await checkTableExists('batch_ssl_jobs');
    if (!batchJobsTableExists) {
      console.log('[DB Migration] 创建 batch_ssl_jobs 表...');
      if (db.type === 'mysql') {
        await db.run(`
          CREATE TABLE batch_ssl_jobs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            job_id VARCHAR(255) UNIQUE NOT NULL,
            user_id INT NOT NULL,
            status VARCHAR(50) DEFAULT 'pending',
            total INT DEFAULT 0,
            done INT DEFAULT 0,
            success INT DEFAULT 0,
            failed INT DEFAULT 0,
            log TEXT,
            results TEXT,
            cert_type VARCHAR(50) DEFAULT 'letsencrypt',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            started_at DATETIME,
            finished_at DATETIME,
            FOREIGN KEY(user_id) REFERENCES users(id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
      } else {
        await db.run(`
          CREATE TABLE batch_ssl_jobs (
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
      }
      console.log('[DB Migration] ✓ batch_ssl_jobs 表创建成功');
    }
  } catch (err) {
    console.error('[DB Migration] 错误:', err.message);
  }
}

// 检查表是否存在
async function checkTableExists(tableName) {
  try {
    if (db.type === 'mysql') {
      const rows = await db.all(`SHOW TABLES LIKE '${tableName}'`);
      return rows.length > 0;
    } else {
      const row = await db.get(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [tableName]);
      return !!row;
    }
  } catch (err) {
    return false;
  }
}

// 执行数据库迁移
migrateDatabase();

// API路由
app.use('/api/auth', authRoutes);
app.use('/api/servers', serverRoutes);
app.use('/api/dns', dnsRoutes);
app.use('/api/users', userRoutes);
app.use('/api/ftp', ftpRoutes);
app.use('/api/nginx', nginxRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/upload-chunked', uploadChunkedRoutes);
app.use('/api/ssl', sslRoutes);
app.use('/api/tags', tagsRoutes);
app.use('/api/system', systemRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// SSL 证书检查 + 自动续期
async function checkAllSslStatus() {
  console.log('[SSL Check] 开始检查证书状态并执行自动续期...');
  try {
    const { checkAndAutoRenew } = require('./services/ssl-auto-renew');
    const result = await checkAndAutoRenew();
    console.log(`[SSL Check] ${result.message}`);
  } catch (err) {
    console.error('[SSL Check] 检查失败:', err.message);
  }
}

// 检查过期子域名并自动停用
async function checkExpiredSubdomains() {
  console.log('[Expire Check] 开始检查过期子域名...');
  try {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    // 获取所有已过期但未停用的子域名（禁用 Nginx，不动 DNS）
    const expiredSubs = await db.all(`
      SELECT s.id, s.subdomain, d.domain as main_domain
      FROM subdomains s 
      LEFT JOIN domains d ON s.domain_id = d.id 
      WHERE s.expire_at IS NOT NULL AND s.expire_at < ? AND s.use_status != 'disabled'
    `, [now]);

    if (expiredSubs.length === 0) {
      console.log('[Expire Check] 没有过期的子域名');
      return;
    }

    const lifecycle = require('./services/subdomain-lifecycle');

    for (const sub of expiredSubs) {
      try {
        const result = await lifecycle.disableSubdomain(sub.id);
        console.log(`[Expire Check] 已停用 ${sub.subdomain}.${sub.main_domain}: ${result.message}`);
      } catch (err) {
        console.error(`[Expire Check] 停用 ${sub.subdomain}.${sub.main_domain} 失败:`, err.message);
      }
    }

    console.log(`[Expire Check] 已处理 ${expiredSubs.length} 个过期子域名（Nginx 禁用，DNS 未改动）`);
  } catch (err) {
    console.error('[Expire Check] 检查失败:', err.message);
  }
}

const { initSslSchedule } = require('./services/ssl-schedule');

// 前端路由
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

// 创建 HTTP 服务器
const server = http.createServer(app);

// 取消 HTTP server 级别的请求超时限制（Node 18+ requestTimeout 默认 5 分钟会中断大文件上传/合并）
server.requestTimeout = 0;   // 单个请求最大时长，0 = 永久不超时
server.timeout = 0;          // socket 空闲超时，0 = 不超时
server.headersTimeout = 0;   // 接收请求头超时，0 = 不超时

// 启动 WebSocket SFTP 代理
new WebSocketSFTPProxy(server);
initSslLogWebSocket(server);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket SFTP Proxy available at ws://localhost:${PORT}/ws-upload`);
  // 启动 SSL 证书定时检查（支持设置变更后热更新）
  initSslSchedule(checkAllSslStatus);
  // 启动时也检查一次
  setTimeout(checkAllSslStatus, 5000);
  // 每小时检查一次过期子域名
  setInterval(checkExpiredSubdomains, 60 * 60 * 1000);
  // 启动时也检查一次
  setTimeout(checkExpiredSubdomains, 10000);
});
