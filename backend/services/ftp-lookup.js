/**
 * 按授权码查找 FTP 账号（含所属服务器 SSH 信息）
 */
const db = require('../db/database');
const { decryptFtpSecrets } = require('../utils/secret-crypto');

const FTP_SELECT = `
  SELECT f.*, s.id as subdomain_id, s.subdomain, s.expire_at, s.use_status, s.activated_at, s.duration_days,
         d.domain as main_domain,
         CASE WHEN s.subdomain = '@' THEN d.domain ELSE ${db.concat('s.subdomain', `'.'`, 'd.domain')} END as full_domain,
         sv.ip, sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass,
         sv.nginx_path
  FROM ftp_accounts f
  LEFT JOIN subdomains s ON f.subdomain_id = s.id
  LEFT JOIN domains d ON s.domain_id = d.id
  LEFT JOIN servers sv ON s.server_id = sv.id
`;

async function findFtpByAuthCode(auth_code, { includeDisabled = false } = {}) {
  const code = String(auth_code || '').trim().toLowerCase();
  if (!code) return null;

  const statusClause = includeDisabled
    ? ''
    : ` AND (s.use_status IS NULL OR s.use_status != 'disabled')`;

  // 等值查询走 auth_code 索引（迁移后空值已回填，一律小写存储）
  const ftp = await db.get(
    `${FTP_SELECT}
     WHERE f.status = 'active'
       AND f.auth_code = ?
       ${statusClause}
     LIMIT 1`,
    [code]
  );

  return ftp ? decryptFtpSecrets(ftp) : null;
}

/** 规范化后判断绝对路径是否位于站点 home 内（含 home 自身） */
function isPathInsideHome(absPath, homeDir) {
  const pathPosix = require('path').posix;
  const home = pathPosix.normalize(String(homeDir || '')).replace(/\/+$/, '') || '/';
  const target = pathPosix.normalize(String(absPath || '')).replace(/\/+$/, '') || '/';
  if (!homeDir || absPath == null || absPath === '') return false;
  return target === home || target.startsWith(`${home}/`);
}

/** 位于 home 内且不是 home 根目录本身（用于禁止删整站根） */
function isStrictlyInsideHome(absPath, homeDir) {
  if (!isPathInsideHome(absPath, homeDir)) return false;
  const pathPosix = require('path').posix;
  const home = pathPosix.normalize(String(homeDir || '')).replace(/\/+$/, '') || '/';
  const target = pathPosix.normalize(String(absPath || '')).replace(/\/+$/, '') || '/';
  return target !== home;
}

module.exports = {
  findFtpByAuthCode,
  isPathInsideHome,
  isStrictlyInsideHome
};
