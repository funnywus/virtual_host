/**
 * 管理端审计日志（异步写入，失败不影响主流程）
 */
const db = require('../db/database');
const { clientIp } = require('../middleware/rate-limit');

let tableReady = false;
let preparing = null;

async function ensureAuditTable() {
  if (tableReady) return;
  if (preparing) return preparing;

  preparing = (async () => {
    await db.run(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NULL,
        username VARCHAR(100) NULL,
        action VARCHAR(100) NOT NULL,
        resource VARCHAR(100) NULL,
        resource_id VARCHAR(100) NULL,
        ip VARCHAR(64) NULL,
        detail TEXT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_audit_created (created_at),
        INDEX idx_audit_action (action)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    tableReady = true;
  })().finally(() => {
    preparing = null;
  });

  return preparing;
}

/**
 * @param {object} opts
 * @param {import('express').Request} [opts.req]
 * @param {number|null} [opts.userId]
 * @param {string|null} [opts.username]
 * @param {string} opts.action  e.g. login.success / server.delete
 * @param {string} [opts.resource]
 * @param {string|number} [opts.resourceId]
 * @param {object|string} [opts.detail]
 */
async function writeAudit(opts = {}) {
  try {
    await ensureAuditTable();
    const req = opts.req;
    const userId = opts.userId ?? req?.user?.id ?? null;
    const username = opts.username ?? req?.user?.username ?? null;
    const ip = opts.ip || (req ? clientIp(req) : null);
    let detail = opts.detail;
    if (detail != null && typeof detail !== 'string') {
      detail = JSON.stringify(detail);
    }
    // 避免把密码等写入审计
    if (typeof detail === 'string' && /password|secret|ssh_pass/i.test(detail)) {
      detail = detail
        .replace(/"(password|secret_key|ssh_pass)"\s*:\s*"[^"]*"/gi, '"$1":"***"')
        .replace(/(password|secret)=([^&\s]+)/gi, '$1=***');
    }

    await db.run(
      `INSERT INTO audit_logs (user_id, username, action, resource, resource_id, ip, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        username,
        String(opts.action || 'unknown'),
        opts.resource || null,
        opts.resourceId != null ? String(opts.resourceId) : null,
        ip,
        detail || null
      ]
    );
  } catch (err) {
    console.error('[Audit] 写入失败:', err.message);
  }
}

function auditFromReq(req, action, extra = {}) {
  return writeAudit({ req, action, ...extra });
}

module.exports = {
  ensureAuditTable,
  writeAudit,
  auditFromReq
};
