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
const SshFtpService = require('./services/ssh-ftp');
const sslCert = require('./services/ssl-cert');
const WebSocketSFTPProxy = require('./services/ws-sftp-proxy');

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

// SSL证书状态检查函数
async function checkAllSslStatus() {
  console.log('[SSL Check] 开始检查所有域名证书状态...');
  try {
    const domains = await db.all('SELECT * FROM domains WHERE ssl_status = ?', ['active']);
    
    for (const domain of domains) {
      try {
        // 获取服务器
        let server = await db.get(`
          SELECT sv.* FROM subdomains s
          LEFT JOIN servers sv ON s.server_id = sv.id
          WHERE s.domain_id = ? AND sv.id IS NOT NULL
          LIMIT 1
        `, [domain.id]);
        
        if (!server) {
          server = await db.get('SELECT * FROM servers LIMIT 1');
        }
        
        if (!server) continue;
        
        const sshService = new SshFtpService({
          ip: server.ip,
          port: server.port,
          username: server.username,
          password: server.password
        });
        
        const checkCmd = sslCert.getCheckCommand(domain.domain);
        const result = await sshService.exec(checkCmd);
        
        if (result.output?.includes('CERT_EXISTS=true')) {
          const afterMatch = result.output.match(/notAfter=(.+)/);
          if (afterMatch) {
            // 解析 openssl 日期格式为标准格式
            let expiresAt = afterMatch[1].trim();
            try {
              const d = new Date(expiresAt);
              if (!isNaN(d.getTime())) {
                expiresAt = formatTime(d);
              }
            } catch (e) {}
            await db.run('UPDATE domains SET ssl_expires = ? WHERE id = ?', [expiresAt, domain.id]);
            console.log(`[SSL Check] ${domain.domain} 证书有效期: ${expiresAt}`);
          }
        }
      } catch (err) {
        console.error(`[SSL Check] ${domain.domain} 检查失败:`, err.message);
      }
    }
    
    console.log('[SSL Check] 证书状态检查完成');
  } catch (err) {
    console.error('[SSL Check] 检查失败:', err.message);
  }
}

// 检查过期子域名并自动停用
async function checkExpiredSubdomains() {
  console.log('[Expire Check] 开始检查过期子域名...');
  try {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    // 获取所有已过期但未停用的子域名
    const expiredSubs = await db.all(`
      SELECT s.*, d.domain as main_domain, ac.access_key, ac.secret_key, ac.platform 
      FROM subdomains s 
      LEFT JOIN domains d ON s.domain_id = d.id 
      LEFT JOIN aliyun_config ac ON d.aliyun_config_id = ac.id 
      WHERE s.expire_at IS NOT NULL AND s.expire_at < ? AND s.use_status != 'disabled'
    `, [now]);

    if (expiredSubs.length === 0) {
      console.log('[Expire Check] 没有过期的子域名');
      return;
    }

    const AliyunDns = require('./services/aliyun-dns');
    const TencentDns = require('./services/tencent-dns');

    for (const sub of expiredSubs) {
      try {
        // 删除DNS记录
        if (sub.aliyun_record_id && sub.access_key && sub.secret_key) {
          let dns;
          if (sub.platform === 'tencent') {
            dns = new TencentDns(sub.access_key, sub.secret_key);
            await dns.deleteRecord(sub.main_domain, sub.aliyun_record_id);
          } else {
            dns = new AliyunDns(sub.access_key, sub.secret_key);
            await dns.deleteRecord(sub.aliyun_record_id);
          }
        }
        
        await db.run('UPDATE subdomains SET use_status = ?, aliyun_record_id = NULL, status = ? WHERE id = ?', 
          ['disabled', 'disabled', sub.id]);
        console.log(`[Expire Check] 已停用过期子域名: ${sub.subdomain}.${sub.main_domain}`);
      } catch (err) {
        console.error(`[Expire Check] 停用 ${sub.subdomain}.${sub.main_domain} 失败:`, err.message);
      }
    }

    console.log(`[Expire Check] 已处理 ${expiredSubs.length} 个过期子域名`);
  } catch (err) {
    console.error('[Expire Check] 检查失败:', err.message);
  }
}

// 每天凌晨3点检查证书状态
function scheduleSslCheck() {
  const now = new Date();
  const next3am = new Date(now);
  next3am.setHours(3, 0, 0, 0);
  if (next3am <= now) {
    next3am.setDate(next3am.getDate() + 1);
  }
  
  const delay = next3am - now;
  console.log(`[SSL Check] 下次检查时间: ${next3am.toLocaleString()}`);
  
  setTimeout(() => {
    checkAllSslStatus();
    // 之后每24小时检查一次
    setInterval(checkAllSslStatus, 24 * 60 * 60 * 1000);
  }, delay);
}

// 前端路由
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;

// 创建 HTTP 服务器
const server = http.createServer(app);

// 启动 WebSocket SFTP 代理
new WebSocketSFTPProxy(server);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`WebSocket SFTP Proxy available at ws://localhost:${PORT}/ws-upload`);
  // 启动SSL证书定时检查
  scheduleSslCheck();
  // 启动时也检查一次
  setTimeout(checkAllSslStatus, 5000);
  // 每小时检查一次过期子域名
  setInterval(checkExpiredSubdomains, 60 * 60 * 1000);
  // 启动时也检查一次
  setTimeout(checkExpiredSubdomains, 10000);
});
