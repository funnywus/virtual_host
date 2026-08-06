/**
 * FTP / 上传页授权码工具
 * - 历史账号多为域名 MD5，存于 auth_code 或可回退计算
 * - 重置后写入随机 32 位 hex，旧码立即失效
 */
const crypto = require('crypto');

function domainAuthCode(domain) {
  if (!domain) return '';
  return crypto.createHash('md5').update(String(domain)).digest('hex').toLowerCase();
}

function randomAuthCode() {
  return crypto.randomBytes(16).toString('hex');
}

/** 账号有效授权码：优先库字段，缺省回退域名 MD5（兼容旧数据） */
function resolveAuthCode(ftp) {
  const stored = String(ftp?.auth_code || '').trim().toLowerCase();
  if (stored) return stored;
  return domainAuthCode(ftp?.full_domain);
}

function matchAuthCode(ftp, input) {
  const code = String(input || '').trim().toLowerCase();
  if (!code) return false;
  return resolveAuthCode(ftp) === code;
}

/** 是否仍为「域名 MD5」弱授权码（可被知悉域名者算出） */
function isLegacyAuthCode(ftp) {
  const domain = ftp?.full_domain;
  if (!domain) return false;
  const stored = String(ftp?.auth_code || '').trim().toLowerCase();
  const md5 = domainAuthCode(domain);
  if (!md5) return false;
  // 库内为空时 resolve 会回退 MD5，也算弱码
  if (!stored) return true;
  return stored === md5;
}

module.exports = {
  domainAuthCode,
  randomAuthCode,
  resolveAuthCode,
  matchAuthCode,
  isLegacyAuthCode
};
