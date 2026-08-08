/**
 * 租户资源所有权校验（admin 可访问全部；非所有者按 404 处理，与 servers 路由一致）
 */
const db = require('../db/database');
const { decryptServerSecrets } = require('../utils/secret-crypto');

function isAdmin(req) {
  return req.user?.role === 'admin';
}

function ownedOrNull(req, row) {
  if (!row) return null;
  if (!isAdmin(req) && Number(row.user_id) !== Number(req.user.id)) return null;
  return row;
}

async function getAccessibleServer(req, serverId) {
  const server = await db.get('SELECT * FROM servers WHERE id = ?', [serverId]);
  const owned = ownedOrNull(req, server);
  return owned ? decryptServerSecrets(owned) : null;
}

async function getAccessibleDomain(req, domainId) {
  const domain = await db.get('SELECT * FROM domains WHERE id = ?', [domainId]);
  return ownedOrNull(req, domain);
}

/** 主域名 + DNS 平台凭据（调用方负责 decryptDnsCreds） */
async function getAccessibleDomainWithDns(req, domainId) {
  const row = await db.get(
    `SELECT d.*, ac.access_key, ac.secret_key, ac.platform, ac.name as aliyun_name
     FROM domains d
     LEFT JOIN aliyun_config ac ON d.aliyun_config_id = ac.id
     WHERE d.id = ?`,
    [domainId]
  );
  return ownedOrNull(req, row);
}

async function getAccessibleAliyunConfig(req, configId) {
  const config = await db.get('SELECT * FROM aliyun_config WHERE id = ?', [configId]);
  return ownedOrNull(req, config);
}

async function getAccessibleTag(req, tagId) {
  const tag = await db.get('SELECT * FROM server_tags WHERE id = ?', [tagId]);
  return ownedOrNull(req, tag);
}

async function getAccessibleBatchSslJob(req, jobId) {
  const job = await db.get('SELECT * FROM batch_ssl_jobs WHERE job_id = ?', [jobId]);
  return ownedOrNull(req, job);
}

async function getAccessibleSubdomain(req, subdomainId) {
  const row = await db.get(
    `SELECT s.*, d.user_id, d.domain as main_domain
     FROM subdomains s
     JOIN domains d ON s.domain_id = d.id
     WHERE s.id = ?`,
    [subdomainId]
  );
  return ownedOrNull(req, row);
}

async function getAccessibleFtpAccount(req, ftpId) {
  const row = await db.get(
    `SELECT f.*, d.user_id, s.subdomain, d.domain as main_domain,
            sv.id as server_id, sv.ip as server_ip, sv.port as ssh_port,
            sv.username as ssh_user, sv.password as ssh_pass, sv.name as server_name
     FROM ftp_accounts f
     JOIN subdomains s ON f.subdomain_id = s.id
     JOIN domains d ON s.domain_id = d.id
     LEFT JOIN servers sv ON s.server_id = sv.id
     WHERE f.id = ?`,
    [ftpId]
  );
  return ownedOrNull(req, row);
}

/** 非 admin 时过滤已拥有的 id 列表；admin 原样返回存在的 id */
async function filterOwnedSubdomainIds(req, ids) {
  const list = (Array.isArray(ids) ? ids : []).map(String).filter(Boolean);
  if (list.length === 0) return [];
  const placeholders = list.map(() => '?').join(',');
  if (isAdmin(req)) {
    const rows = await db.all(`SELECT id FROM subdomains WHERE id IN (${placeholders})`, list);
    return rows.map((r) => r.id);
  }
  const rows = await db.all(
    `SELECT s.id FROM subdomains s
     JOIN domains d ON s.domain_id = d.id
     WHERE s.id IN (${placeholders}) AND d.user_id = ?`,
    [...list, req.user.id]
  );
  return rows.map((r) => r.id);
}

/**
 * 设置默认项：仅能设置自己拥有（或 admin 代管）的资源
 * @returns {object|null} 资源行；null 表示不可访问
 */
async function setDefaultOwned(req, table, id) {
  const allowed = new Set(['domains', 'aliyun_config', 'server_tags', 'servers']);
  if (!allowed.has(table)) throw new Error(`unsupported table: ${table}`);

  const row = await db.get(`SELECT * FROM ${table} WHERE id = ?`, [id]);
  const owned = ownedOrNull(req, row);
  if (!owned) return null;

  const ownerId = owned.user_id;
  await db.run(`UPDATE ${table} SET is_default = 0 WHERE user_id = ?`, [ownerId]);
  await db.run(`UPDATE ${table} SET is_default = 1 WHERE id = ? AND user_id = ?`, [id, ownerId]);
  return owned;
}

function notFound(res, message = 'Not found') {
  return res.status(404).json({ error: message });
}

module.exports = {
  isAdmin,
  getAccessibleServer,
  getAccessibleDomain,
  getAccessibleDomainWithDns,
  getAccessibleAliyunConfig,
  getAccessibleTag,
  getAccessibleBatchSslJob,
  getAccessibleSubdomain,
  getAccessibleFtpAccount,
  filterOwnedSubdomainIds,
  setDefaultOwned,
  notFound
};
