/**
 * 证书检查 + 自动续期
 */
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const db = require('../db/database');
const SshFtpService = require('./ssh-ftp');
const sslCert = require('./ssl-cert');
const { getSettings, saveSettings } = require('./system-settings');

const LOCAL_CERT_BASE_DIR = path.join(__dirname, '..', 'uploads', 'certs');

function formatTime(date = new Date()) {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function parseOpenSSLDate(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return dateStr;
    return formatTime(d);
  } catch {
    return dateStr;
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

async function getDefaultServer(userId = null) {
  const where = userId
    ? 'WHERE user_id = ? AND (status IS NULL OR status != ?)'
    : 'WHERE (status IS NULL OR status != ?)';
  const params = userId ? [userId, 'disabled'] : ['disabled'];
  return db.get(`
    SELECT * FROM servers
    ${where}
    ORDER BY is_default DESC, id ASC
    LIMIT 1
  `, params);
}

async function saveCertToLocal(domain, sshService, expiresAt = null) {
  const safeName = String(domain || '').trim().replace(/[^a-zA-Z0-9.-]/g, '_');
  if (!safeName) return null;
  const dir = path.join(LOCAL_CERT_BASE_DIR, safeName);
  await fsp.mkdir(dir, { recursive: true });

  const remote = sslCert.getCertPath(domain);
  const fullchainRes = await sshService.exec(`cat ${shellQuote(remote.fullchain)} 2>/dev/null || true`);
  const keyRes = await sshService.exec(`cat ${shellQuote(remote.key)} 2>/dev/null || true`);
  const fullchain = fullchainRes.output?.trim() || '';
  const key = keyRes.output?.trim() || '';
  if (!fullchain || !key) return null;

  await fsp.writeFile(path.join(dir, `${safeName}.fullchain.crt`), fullchain, 'utf8');
  await fsp.writeFile(path.join(dir, `${safeName}.key`), key, 'utf8');
  await fsp.writeFile(path.join(dir, `${safeName}.crt`), fullchain, 'utf8');
  await fsp.writeFile(path.join(dir, 'metadata.json'), JSON.stringify({
    domain,
    expires: expiresAt,
    updated_at: formatTime()
  }, null, 2), 'utf8');
  return { dir };
}

/** 优先用该主域名下子域名所在服务器，避免多机环境下续期打到错误主机 */
async function getServerForDomain(domain) {
  let server = await db.get(`
    SELECT sv.* FROM subdomains s
    LEFT JOIN servers sv ON s.server_id = sv.id
    WHERE s.domain_id = ? AND sv.id IS NOT NULL
      AND (sv.status IS NULL OR sv.status != 'disabled')
    ORDER BY s.id ASC
    LIMIT 1
  `, [domain.id]);
  if (!server) server = await getDefaultServer(domain.user_id);
  return server;
}

async function syncDomainExpiry(domain) {
  const server = await getServerForDomain(domain);
  if (!server?.ip) return { success: false, skipped: true, message: '无可用服务器' };

  const sshService = new SshFtpService({
    ip: server.ip,
    port: server.port,
    username: server.username,
    password: server.password
  });

  const result = await sshService.exec(sslCert.getCheckCommand(domain.domain));
  if (!result.output?.includes('CERT_EXISTS=true')) {
    return { success: false, message: '远程未找到证书' };
  }

  const afterMatch = result.output.match(/notAfter=(.+)/);
  if (!afterMatch) return { success: true, message: '已存在但未解析到期时间' };

  const expiresAt = parseOpenSSLDate(afterMatch[1].trim());
  await db.run('UPDATE domains SET ssl_expires = ? WHERE id = ?', [expiresAt, domain.id]);
  return { success: true, expires: expiresAt };
}

async function renewDomain(domain) {
  const startTime = formatTime();
  let log = `[${startTime}] [自动续期] 开始续期 ${domain.domain}\n`;

  const server = await getServerForDomain(domain);
  if (!server?.ip) {
    return { success: false, domain: domain.domain, message: '没有可用服务器', log };
  }

  const sshService = new SshFtpService({
    ip: server.ip,
    port: server.port,
    username: server.username,
    password: server.password
  });

  log += `[${formatTime()}] 服务器: ${server.name || server.ip}\n`;
  await db.run('UPDATE domains SET ssl_status = ?, ssl_log = ? WHERE id = ?', ['renewing', log, domain.id]);

  const checkCmd = sslCert.getCheckCommand(domain.domain);
  const checkResult = await sshService.exec(checkCmd);
  const isWildcard = checkResult.output?.includes(`*.${domain.domain}`);
  const renewCmd = sslCert.getRenewCommand(domain.domain, isWildcard);
  const result = await sshService.exec(renewCmd);

  log += `[${formatTime()}] 命令执行完成\n`;
  log += `--- 输出 ---\n${(result.output || '').slice(0, 4000)}\n--- 结束 ---\n`;

  const ok = result.success
    || result.output?.includes('Cert success')
    || result.output?.includes('Renew success')
    || result.output?.includes('Congratulations');

  if (!ok) {
    await db.run('UPDATE domains SET ssl_status = ?, ssl_log = ? WHERE id = ?', ['error', log, domain.id]);
    return { success: false, domain: domain.domain, message: '续期失败', log };
  }

  const newCheck = await sshService.exec(checkCmd);
  let expiresAt = null;
  const afterMatch = newCheck.output?.match(/notAfter=(.+)/);
  if (afterMatch) expiresAt = parseOpenSSLDate(afterMatch[1].trim());

  try {
    await saveCertToLocal(domain.domain, sshService, expiresAt);
    log += `[${formatTime()}] 已同步本地证书\n`;
  } catch (e) {
    log += `[${formatTime()}] 本地同步失败: ${e.message}\n`;
  }

  log += `[${formatTime()}] 续期成功，新到期: ${expiresAt || '未知'}\n`;
  await db.run(
    'UPDATE domains SET ssl_status = ?, ssl_expires = ?, ssl_log = ? WHERE id = ?',
    ['active', expiresAt, log, domain.id]
  );

  return { success: true, domain: domain.domain, expires: expiresAt, message: '续期成功', log };
}

function needsRenew(domain, beforeDays) {
  if (!domain.ssl_expires) return false;
  const exp = new Date(domain.ssl_expires).getTime();
  if (Number.isNaN(exp)) return false;
  const threshold = Date.now() + beforeDays * 86400000;
  return exp <= threshold;
}

async function checkAndAutoRenew({ force = false } = {}) {
  const settings = await getSettings();
  const beforeDays = settings.ssl_renew_before_days || 30;
  const domains = await db.all(`SELECT * FROM domains WHERE ssl_status IN ('active', 'error', 'renewing') OR ssl_expires IS NOT NULL`);

  const checkResults = [];
  for (const domain of domains) {
    if (domain.ssl_status === 'active' || domain.ssl_expires) {
      try {
        const r = await syncDomainExpiry(domain);
        checkResults.push({ domain: domain.domain, ...r });
      } catch (e) {
        checkResults.push({ domain: domain.domain, success: false, message: e.message });
      }
    }
  }

  await saveSettings({ last_ssl_check_at: formatTime() });

  const renewResults = [];
  if (!settings.ssl_auto_renew && !force) {
    return {
      checked: checkResults.length,
      checkResults,
      auto_renew: false,
      renewed: 0,
      failed: 0,
      renewResults,
      message: '已同步证书到期时间（自动续期已关闭）'
    };
  }

  const freshDomains = await db.all(`SELECT * FROM domains WHERE ssl_status = 'active' OR ssl_expires IS NOT NULL`);
  const targets = freshDomains.filter(d => needsRenew(d, beforeDays) || (force && d.ssl_status === 'active'));

  for (const domain of targets) {
    // force 全量续期时只处理 active / 将到期；日常按 beforeDays
    if (!force && !needsRenew(domain, beforeDays)) continue;
    if (force && !needsRenew(domain, beforeDays) && domain.ssl_status !== 'active') continue;
    try {
      console.log(`[SSL AutoRenew] 续期 ${domain.domain} ...`);
      const r = await renewDomain(domain);
      renewResults.push(r);
      console.log(`[SSL AutoRenew] ${domain.domain}: ${r.message}`);
    } catch (e) {
      renewResults.push({ success: false, domain: domain.domain, message: e.message });
      console.error(`[SSL AutoRenew] ${domain.domain} 失败:`, e.message);
    }
  }

  const summary = {
    at: formatTime(),
    candidates: targets.length,
    renewed: renewResults.filter(r => r.success).length,
    failed: renewResults.filter(r => !r.success).length
  };
  await saveSettings({
    last_ssl_renew_at: formatTime(),
    last_ssl_renew_summary: summary
  });

  return {
    checked: checkResults.length,
    checkResults,
    auto_renew: true,
    renewed: summary.renewed,
    failed: summary.failed,
    before_days: beforeDays,
    renewResults,
    message: summary.renewed || summary.failed
      ? `检查完成，自动续期成功 ${summary.renewed}，失败 ${summary.failed}`
      : `检查完成，暂无需要续期的证书（阈值 ${beforeDays} 天）`
  };
}

module.exports = {
  checkAndAutoRenew,
  renewDomain,
  syncDomainExpiry,
  needsRenew
};
