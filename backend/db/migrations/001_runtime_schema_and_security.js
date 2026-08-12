/**
 * 将历史上散落在 server.js / 脚本中的增量迁移收敛为可版本化入口。
 * 幂等：字段/表/索引已存在则跳过。
 */
module.exports = {
  id: '001_runtime_schema_and_security',

  async up({ db, getTableColumns, checkTableExists }) {
    const domainsColumns = await getTableColumns('domains');
    if (!domainsColumns.some((col) => col.name === 'expire_at')) {
      await db.run('ALTER TABLE domains ADD COLUMN expire_at DATETIME DEFAULT NULL');
      console.log('[DB Migration]   + domains.expire_at');
    }

    const serversColumns = await getTableColumns('servers');
    if (!serversColumns.some((col) => col.name === 'expire_at')) {
      await db.run('ALTER TABLE servers ADD COLUMN expire_at DATETIME DEFAULT NULL');
      console.log('[DB Migration]   + servers.expire_at');
    }
    if (!serversColumns.some((col) => col.name === 'status')) {
      await db.run("ALTER TABLE servers ADD COLUMN status VARCHAR(20) DEFAULT 'active'");
      console.log('[DB Migration]   + servers.status');
    }

    const batchJobsTableExists = await checkTableExists('batch_ssl_jobs');
    if (!batchJobsTableExists) {
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
      console.log('[DB Migration]   + batch_ssl_jobs');
    }

    // 授权码回填 + 索引
    try {
      const { domainAuthCode } = require('../../services/ftp-auth');
      const missing = await db.all(`
        SELECT f.id,
               CASE WHEN s.subdomain = '@' THEN d.domain ELSE ${db.concat('s.subdomain', `'.'`, 'd.domain')} END as full_domain
        FROM ftp_accounts f
        LEFT JOIN subdomains s ON f.subdomain_id = s.id
        LEFT JOIN domains d ON s.domain_id = d.id
        WHERE f.auth_code IS NULL OR TRIM(f.auth_code) = ''
      `);
      let filled = 0;
      for (const row of missing || []) {
        const code = domainAuthCode(row.full_domain);
        if (!code) continue;
        await db.run('UPDATE ftp_accounts SET auth_code = ? WHERE id = ?', [code, row.id]);
        filled += 1;
      }
      if (filled > 0) {
        console.log(`[DB Migration]   + 回填 ${filled} 条空授权码`);
      }

      await db.run(
        `UPDATE ftp_accounts SET auth_code = LOWER(auth_code) WHERE auth_code IS NOT NULL AND auth_code != LOWER(auth_code)`
      );

      const idx = await db.all(`SHOW INDEX FROM ftp_accounts WHERE Key_name = 'idx_ftp_auth_code'`);
      if (!idx || idx.length === 0) {
        await db.run('CREATE INDEX idx_ftp_auth_code ON ftp_accounts (auth_code)');
        console.log('[DB Migration]   + idx_ftp_auth_code');
      }
    } catch (err) {
      console.error('[DB Migration]   授权码索引/回填:', err.message);
    }

    // 敏感字段明文 → AES-GCM
    try {
      const { encryptSecret, isEncrypted } = require('../../utils/secret-crypto');
      let migrated = 0;

      const servers = await db.all("SELECT id, password FROM servers WHERE password IS NOT NULL AND password != ''");
      for (const row of servers || []) {
        if (isEncrypted(row.password)) continue;
        await db.run('UPDATE servers SET password = ? WHERE id = ?', [encryptSecret(row.password), row.id]);
        migrated += 1;
      }

      const ftps = await db.all("SELECT id, password FROM ftp_accounts WHERE password IS NOT NULL AND password != ''");
      for (const row of ftps || []) {
        if (isEncrypted(row.password)) continue;
        await db.run('UPDATE ftp_accounts SET password = ? WHERE id = ?', [encryptSecret(row.password), row.id]);
        migrated += 1;
      }

      const dnsConfigs = await db.all(
        "SELECT id, access_key, secret_key FROM aliyun_config WHERE (access_key IS NOT NULL AND access_key != '') OR (secret_key IS NOT NULL AND secret_key != '')"
      );
      for (const row of dnsConfigs || []) {
        const access = isEncrypted(row.access_key) ? row.access_key : encryptSecret(row.access_key);
        const secret = isEncrypted(row.secret_key) ? row.secret_key : encryptSecret(row.secret_key);
        if (access === row.access_key && secret === row.secret_key) continue;
        await db.run('UPDATE aliyun_config SET access_key = ?, secret_key = ? WHERE id = ?', [access, secret, row.id]);
        migrated += 1;
      }

      if (migrated > 0) {
        console.log(`[DB Migration]   + 加密迁移 ${migrated} 条敏感凭据`);
      }
    } catch (err) {
      console.error('[DB Migration]   凭据加密:', err.message);
    }

    // 审计表
    try {
      const { ensureAuditTable } = require('../../services/audit-log');
      await ensureAuditTable();
    } catch (err) {
      console.error('[DB Migration]   audit_logs:', err.message);
    }
  }
};
