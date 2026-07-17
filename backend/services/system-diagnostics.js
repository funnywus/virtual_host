/**
 * 系统运维检测：统计、连通性、站点健康、临时目录清理
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const net = require('net');
const db = require('../db/database');
const AliyunDns = require('./aliyun-dns');
const TencentDns = require('./tencent-dns');

const TEMP_CHUNKS_DIR = path.join(__dirname, '../temp/chunks');

function formatTime(date = new Date()) {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function testTcp(ip, port, timeout = 5000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const start = Date.now();
    socket.setTimeout(timeout);
    socket.on('connect', () => {
      const latency = Date.now() - start;
      socket.destroy();
      resolve({ success: true, message: `连接成功，延迟 ${latency}ms`, latency });
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ success: false, message: '连接超时' });
    });
    socket.on('error', (err) => {
      socket.destroy();
      resolve({ success: false, message: `连接失败: ${err.message}` });
    });
    socket.connect(port || 22, ip);
  });
}

async function getDirSize(dir) {
  if (!fs.existsSync(dir)) return { bytes: 0, files: 0, sessions: 0 };
  let bytes = 0;
  let files = 0;
  const sessions = fs.readdirSync(dir);
  for (const name of sessions) {
    const full = path.join(dir, name);
    try {
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        const walk = (p) => {
          for (const entry of fs.readdirSync(p)) {
            const ep = path.join(p, entry);
            const es = fs.statSync(ep);
            if (es.isDirectory()) walk(ep);
            else {
              bytes += es.size;
              files += 1;
            }
          }
        };
        walk(full);
      } else {
        bytes += st.size;
        files += 1;
      }
    } catch (_) { /* skip */ }
  }
  return { bytes, files, sessions: sessions.length };
}

async function getStats() {
  const now = formatTime();
  const soon = new Date();
  soon.setDate(soon.getDate() + 5);

  const [
    domains,
    subdomains,
    servers,
    ftp,
    expired,
    expiringSoon,
    disabled,
    nginxUnsynced,
    sslActive,
    sslFailed,
    dnsError
  ] = await Promise.all([
    db.get('SELECT COUNT(*) as c FROM domains'),
    db.get('SELECT COUNT(*) as c FROM subdomains'),
    db.get('SELECT COUNT(*) as c FROM servers'),
    db.get('SELECT COUNT(*) as c FROM ftp_accounts'),
    db.get(`SELECT COUNT(*) as c FROM subdomains WHERE expire_at IS NOT NULL AND expire_at < ? AND COALESCE(use_status, 'unused') != 'disabled'`, [now]),
    db.get(`SELECT COUNT(*) as c FROM subdomains WHERE expire_at IS NOT NULL AND expire_at >= ? AND expire_at < ?`, [now, formatTime(soon)]),
    db.get(`SELECT COUNT(*) as c FROM subdomains WHERE COALESCE(use_status, 'unused') = 'disabled'`),
    db.get(`SELECT COUNT(*) as c FROM subdomains WHERE COALESCE(nginx_synced, 0) = 0 AND nginx_config IS NOT NULL AND nginx_config != ''`),
    db.get(`SELECT COUNT(*) as c FROM domains WHERE ssl_status = 'active'`),
    db.get(`SELECT COUNT(*) as c FROM domains WHERE ssl_status IN ('failed', 'error')`),
    db.get(`SELECT COUNT(*) as c FROM subdomains WHERE status = 'dns_error'`)
  ]);

  const temp = await getDirSize(TEMP_CHUNKS_DIR);

  return {
    domains: domains?.c || 0,
    subdomains: subdomains?.c || 0,
    servers: servers?.c || 0,
    ftp: ftp?.c || 0,
    expired_active: expired?.c || 0,
    expiring_soon: expiringSoon?.c || 0,
    disabled: disabled?.c || 0,
    nginx_unsynced: nginxUnsynced?.c || 0,
    ssl_active: sslActive?.c || 0,
    ssl_failed: sslFailed?.c || 0,
    dns_error: dnsError?.c || 0,
    temp_sessions: temp.sessions,
    temp_files: temp.files,
    temp_bytes: temp.bytes
  };
}

async function checkServers() {
  const servers = await db.all('SELECT id, name, ip, port, status FROM servers ORDER BY id');
  const results = [];
  for (const s of servers) {
    if (s.status === 'disabled') {
      results.push({ id: s.id, name: s.name, ip: s.ip, port: s.port, success: false, skipped: true, message: '服务器已禁用' });
      continue;
    }
    const r = await testTcp(s.ip, s.port || 22);
    results.push({ id: s.id, name: s.name, ip: s.ip, port: s.port || 22, ...r });
  }
  const ok = results.filter(r => r.success).length;
  return {
    total: results.length,
    success: ok,
    failed: results.length - ok,
    results
  };
}

async function checkDnsPlatforms() {
  const configs = await db.all('SELECT id, name, platform, access_key, secret_key FROM aliyun_config ORDER BY id');
  const results = [];

  for (const c of configs) {
    const platform = c.platform || 'aliyun';
    try {
      if (platform === 'tencent') {
        const dns = new TencentDns(c.access_key, c.secret_key);
        await dns.getDomainList();
        results.push({ id: c.id, name: c.name, platform, success: true, message: '腾讯云 DNS 连接成功' });
      } else if (platform === 'aliyun') {
        const dns = new AliyunDns(c.access_key, c.secret_key);
        await dns.request('DescribeDomains', { PageSize: 1 });
        results.push({ id: c.id, name: c.name, platform, success: true, message: '阿里云 DNS 连接成功' });
      } else {
        results.push({ id: c.id, name: c.name, platform, success: true, skipped: true, message: `${platform} 暂不支持自动检测` });
      }
    } catch (e) {
      results.push({ id: c.id, name: c.name, platform, success: false, message: e.message });
    }
  }

  const ok = results.filter(r => r.success).length;
  return {
    total: results.length,
    success: ok,
    failed: results.filter(r => !r.success).length,
    results
  };
}

async function checkSiteHealth({ limit = 200 } = {}) {
  const now = formatTime();
  const soon = new Date();
  soon.setDate(soon.getDate() + 5);

  const rows = await db.all(`
    SELECT s.id, s.subdomain, s.status, s.use_status, s.expire_at, s.nginx_synced, s.nginx_config,
           s.ssl_status, s.server_id, d.domain as main_domain, d.ssl_status as domain_ssl_status, d.ssl_expires,
           sv.name as server_name, sv.ip as server_ip,
           f.id as ftp_id, f.auth_code
    FROM subdomains s
    LEFT JOIN domains d ON s.domain_id = d.id
    LEFT JOIN servers sv ON s.server_id = sv.id
    LEFT JOIN ftp_accounts f ON f.subdomain_id = s.id
    ORDER BY s.id DESC
    LIMIT ?
  `, [limit]);

  const issues = [];
  let healthy = 0;

  for (const row of rows) {
    const full = row.subdomain === '@' ? row.main_domain : `${row.subdomain}.${row.main_domain}`;
    const problems = [];

    if (!row.server_id || !row.server_ip) problems.push('未关联服务器');
    if (!row.ftp_id) problems.push('无 FTP 账号');
    if (row.nginx_config && !row.nginx_synced) problems.push('Nginx 未同步');
    if (!row.nginx_config) problems.push('无 Nginx 配置');
    if (row.status === 'dns_error') problems.push('DNS 解析异常');
    if (row.expire_at && new Date(row.expire_at) < new Date() && row.use_status !== 'disabled') {
      problems.push('已过期仍未停用');
    } else if (row.expire_at && new Date(row.expire_at) >= new Date() && new Date(row.expire_at) < soon) {
      problems.push('即将过期（≤5天）');
    }
    if (row.use_status === 'disabled') problems.push('已停用');
    if (row.domain_ssl_status === 'failed' || row.domain_ssl_status === 'error') {
      problems.push('主域名 SSL 异常');
    }

    if (problems.length === 0) {
      healthy += 1;
    } else {
      issues.push({
        id: row.id,
        domain: full,
        server: row.server_name || '-',
        use_status: row.use_status || 'unused',
        problems
      });
    }
  }

  return {
    scanned: rows.length,
    healthy,
    issue_count: issues.length,
    issues: issues.slice(0, 100)
  };
}

async function runExpireCheck() {
  const lifecycle = require('./subdomain-lifecycle');
  const now = formatTime();
  const expiredSubs = await db.all(`
    SELECT s.id, s.subdomain, d.domain as main_domain
    FROM subdomains s
    LEFT JOIN domains d ON s.domain_id = d.id
    WHERE s.expire_at IS NOT NULL AND s.expire_at < ? AND COALESCE(s.use_status, 'unused') != 'disabled'
  `, [now]);

  const results = [];
  for (const sub of expiredSubs) {
    try {
      const r = await lifecycle.disableSubdomain(sub.id);
      results.push({
        id: sub.id,
        domain: `${sub.subdomain}.${sub.main_domain}`,
        success: true,
        message: r.message
      });
    } catch (e) {
      results.push({
        id: sub.id,
        domain: `${sub.subdomain}.${sub.main_domain}`,
        success: false,
        message: e.message
      });
    }
  }

  return {
    total: expiredSubs.length,
    disabled: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results
  };
}

async function cleanupTemp() {
  if (!fs.existsSync(TEMP_CHUNKS_DIR)) {
    return { cleaned: 0, total: 0, message: '临时目录不存在，无需清理' };
  }

  const before = await getDirSize(TEMP_CHUNKS_DIR);
  const sessions = await fsp.readdir(TEMP_CHUNKS_DIR);
  let cleaned = 0;
  for (const id of sessions) {
    try {
      await fsp.rm(path.join(TEMP_CHUNKS_DIR, id), { recursive: true, force: true });
      cleaned += 1;
    } catch (_) { /* skip */ }
  }
  const after = await getDirSize(TEMP_CHUNKS_DIR);

  return {
    cleaned,
    total: sessions.length,
    freed_bytes: Math.max(0, before.bytes - after.bytes),
    message: `已清理 ${cleaned}/${sessions.length} 个上传会话`
  };
}

async function runFullDiagnose() {
  const [stats, expire, servers, dns, sites] = await Promise.all([
    getStats(),
    runExpireCheck(),
    checkServers(),
    checkDnsPlatforms(),
    checkSiteHealth()
  ]);

  return {
    finished_at: formatTime(),
    stats,
    expire,
    servers,
    dns,
    sites
  };
}

module.exports = {
  getStats,
  checkServers,
  checkDnsPlatforms,
  checkSiteHealth,
  runExpireCheck,
  cleanupTemp,
  runFullDiagnose,
  getDirSize,
  TEMP_CHUNKS_DIR,
  formatTime
};
