/**
 * 按授权码查找 FTP 账号（含所属服务器 SSH 信息）
 */
const db = require('../db/database');
const { matchAuthCode } = require('./ftp-auth');

async function findFtpByAuthCode(auth_code, { includeDisabled = false } = {}) {
  const statusClause = includeDisabled
    ? ''
    : ` AND (s.use_status IS NULL OR s.use_status != 'disabled')`;

  const ftpAccounts = await db.all(`
    SELECT f.*, s.id as subdomain_id, s.subdomain, s.expire_at, s.use_status, s.activated_at, s.duration_days,
           d.domain as main_domain,
           CASE WHEN s.subdomain = '@' THEN d.domain ELSE ${db.concat('s.subdomain', `'.'`, 'd.domain')} END as full_domain,
           sv.ip, sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass,
           sv.nginx_path
    FROM ftp_accounts f
    LEFT JOIN subdomains s ON f.subdomain_id = s.id
    LEFT JOIN domains d ON s.domain_id = d.id
    LEFT JOIN servers sv ON s.server_id = sv.id
    WHERE f.status = 'active'${statusClause}
  `);

  return ftpAccounts.find(f => matchAuthCode(f, auth_code)) || null;
}

/** 规范化后判断绝对路径是否位于站点 home 内 */
function isPathInsideHome(absPath, homeDir) {
  const home = String(homeDir || '').replace(/\/+$/, '');
  const target = String(absPath || '').replace(/\/+$/, '') || absPath;
  if (!home || !target) return false;
  return target === home || target.startsWith(`${home}/`);
}

module.exports = {
  findFtpByAuthCode,
  isPathInsideHome
};
