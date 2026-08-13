const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');
require('dotenv').config();

const { assertRequiredSecrets } = require('./utils/env-check');
// 启动即校验密钥，避免以弱默认值对外服务
assertRequiredSecrets();

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

function buildCorsOptions() {
  const configured = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  return {
    origin(origin, callback) {
      // 非浏览器 / 同源请求常无 Origin
      if (!origin) return callback(null, true);
      if (configured.includes('*')) return callback(null, true);
      if (configured.length > 0) {
        return callback(null, configured.includes(origin));
      }
      // 未配置时仅放行本机开发 Origin；生产请设置 CORS_ORIGINS
      const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
      return callback(null, isLocal);
    },
    credentials: true
  };
}

app.use(cors(buildCorsOptions()));

const defaultJsonLimit = process.env.JSON_BODY_LIMIT || '2mb';
const uploadJsonLimit = process.env.UPLOAD_JSON_LIMIT || '64mb';

// 上传相关接口允许较大 JSON（历史 base64 直传）；其余 API 收紧默认限制
app.use('/api/upload', bodyParser.json({ limit: uploadJsonLimit }), bodyParser.urlencoded({ limit: uploadJsonLimit, extended: true }));
app.use('/api/upload-chunked', bodyParser.json({ limit: '1mb' }), bodyParser.urlencoded({ limit: '1mb', extended: true }));
app.use(bodyParser.json({ limit: defaultJsonLimit }));
app.use(bodyParser.urlencoded({ limit: defaultJsonLimit, extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 设置超时时间为 30 分钟（支持大文件上传和合并）
app.use((req, res, next) => {
  req.setTimeout(1800000); // 30 分钟
  res.setTimeout(1800000);
  next();
});

// 初始化数据库
db.init();

// 统一版本化迁移（见 backend/db/migrations/）
const { runMigrations } = require('./db/migrate');
runMigrations().catch((err) => {
  console.error('[DB Migration] 执行失败:', err.message);
});

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

// 健康检查（含 SSH 池摘要，便于运维探活）
app.get('/api/health', (req, res) => {
  let sshPool = null;
  try {
    sshPool = require('./utils/ssh-connection-pool').getStatus();
  } catch {
    /* ignore */
  }
  res.json({
    status: 'ok',
    db: db.type || 'unknown',
    uptime: Math.floor(process.uptime()),
    ssh_pool: sshPool
  });
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
    const result = await lifecycle.batchSetUseStatus(expiredSubs.map((s) => s.id), 'disabled');
    if (result.success) {
      console.log(`[Expire Check] 批量停用 ${result.total} 个过期子域名（并行同步，DNS 未改动）`);
    } else {
      console.error(`[Expire Check] 批量停用失败（已回退）: ${result.message}`);
    }
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
  const baseUrl = `http://localhost:${PORT}`;
  console.log(`Server running on port ${PORT}`);
  console.log(`前台(管理后台): ${baseUrl}/admin-jm`);
  console.log(`前台(上传页):   ${baseUrl}/`);
  console.log(`后台接口:       ${baseUrl}/api`);
  console.log(`WebSocket SFTP: ws://localhost:${PORT}/ws-upload`);
  // 审计表惰性创建（失败不影响主服务）
  try {
    const { ensureAuditTable } = require('./services/audit-log');
    ensureAuditTable().catch((err) => console.error('[Audit] 初始化失败:', err.message));
  } catch (err) {
    console.error('[Audit] 加载失败:', err.message);
  }
  // 启动 SSL 证书定时检查（支持设置变更后热更新）
  initSslSchedule(checkAllSslStatus);
  // 启动时也检查一次
  setTimeout(checkAllSslStatus, 5000);
  // 每小时检查一次过期子域名
  setInterval(checkExpiredSubdomains, 60 * 60 * 1000);
  // 启动时也检查一次
  setTimeout(checkExpiredSubdomains, 10000);
});
