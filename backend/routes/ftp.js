const express = require('express');
const crypto = require('crypto');
const db = require('../db/database');
const { authMiddleware } = require('../middleware/auth');
const SshFtpService = require('../services/ssh-ftp');
const { randomAuthCode, resolveAuthCode, isLegacyAuthCode } = require('../services/ftp-auth');
const { encryptSecret, decryptFtpSecrets } = require('../utils/secret-crypto');
const { writeAudit } = require('../services/audit-log');
const {
  getAccessibleSubdomain,
  getAccessibleFtpAccount,
  notFound
} = require('../middleware/ownership');

const router = express.Router();

router.use(authMiddleware);

// 生成随机密码
function generatePassword(length = 12) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < length; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

// 生成FTP用户名
function generateUsername(subdomain, domain) {
  const base = subdomain === '@' ? domain.split('.')[0] : subdomain;
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base}_${suffix}`.substring(0, 16).replace(/[^a-zA-Z0-9_]/g, '');
}

function buildFtpWhere(userId, keyword) {
  const where = [];
  const params = [];
  if (userId) {
    where.push('d.user_id = ?');
    params.push(userId);
  }
  if (keyword) {
    const like = `%${keyword}%`;
    const fullDomainExpr = `CASE WHEN s.subdomain = '@' THEN d.domain ELSE ${db.concat('s.subdomain', `'.'`, 'd.domain')} END`;
    where.push(`(
      f.username LIKE ? OR f.home_dir LIKE ? OR f.auth_code LIKE ?
      OR d.domain LIKE ? OR s.subdomain LIKE ?
      OR sv.name LIKE ? OR sv.ip LIKE ?
      OR ${fullDomainExpr} LIKE ?
    )`);
    params.push(like, like, like, like, like, like, like, like);
  }
  return {
    clause: where.length ? ` WHERE ${where.join(' AND ')}` : '',
    params
  };
}

// 获取FTP账号列表
router.get('/', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 10, 1), 100);
    const offset = (page - 1) * pageSize;
    const keyword = String(req.query.keyword || '').trim();
    
    const userId = req.user.role === 'admin' ? null : req.user.id;
    const { clause, params: whereParams } = buildFtpWhere(userId, keyword);
    
    const countResult = await db.get(`
      SELECT COUNT(*) as total
      FROM ftp_accounts f
      LEFT JOIN subdomains s ON f.subdomain_id = s.id
      LEFT JOIN domains d ON s.domain_id = d.id
      LEFT JOIN servers sv ON s.server_id = sv.id
      ${clause}
    `, whereParams);
    const total = countResult?.total || 0;
    
    const accounts = await db.all(`
      SELECT f.*, s.subdomain, d.domain as main_domain, sv.name as server_name, sv.ip as server_ip,
             sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass,
             CASE WHEN s.subdomain = '@' THEN d.domain ELSE ${db.concat('s.subdomain', `'.'`, 'd.domain')} END as full_domain
      FROM ftp_accounts f
      LEFT JOIN subdomains s ON f.subdomain_id = s.id
      LEFT JOIN domains d ON s.domain_id = d.id
      LEFT JOIN servers sv ON s.server_id = sv.id
      ${clause}
      ORDER BY f.created_at DESC LIMIT ? OFFSET ?
    `, [...whereParams, pageSize, offset]);
    
    // 列表返回授权码；空值补随机码（不再回写可推算的域名 MD5）
    for (const acc of accounts) {
      if (!acc.auth_code) {
        const code = randomAuthCode();
        await db.run('UPDATE ftp_accounts SET auth_code = ? WHERE id = ?', [code, acc.id]);
        acc.auth_code = code;
      } else {
        acc.auth_code = resolveAuthCode(acc);
      }
      decryptFtpSecrets(acc);
      acc.auth_code_weak = isLegacyAuthCode(acc);
      acc.used_size = null;
    }
    
    res.json({ 
      list: accounts, 
      total, 
      page, 
      pageSize,
      keyword
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取单个 FTP 账号已使用空间
router.get('/:id/usage', async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? null : req.user.id;
    let sql = `
      SELECT f.id, f.home_dir, s.subdomain, d.domain as main_domain,
             sv.ip as server_ip, sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass,
             CASE WHEN s.subdomain = '@' THEN d.domain ELSE ${db.concat('s.subdomain', `'.'`, 'd.domain')} END as full_domain
      FROM ftp_accounts f
      LEFT JOIN subdomains s ON f.subdomain_id = s.id
      LEFT JOIN domains d ON s.domain_id = d.id
      LEFT JOIN servers sv ON s.server_id = sv.id
      WHERE f.id = ?
    `;
    const params = [req.params.id];

    if (userId) {
      sql += ' AND d.user_id = ?';
      params.push(userId);
    }

    const ftp = await db.get(sql, params);
    if (!ftp) {
      return res.status(404).json({ error: 'FTP account not found' });
    }
    decryptFtpSecrets(ftp);

    let usedSize = 0;
    if (ftp.server_ip && ftp.home_dir) {
      const sshService = new SshFtpService({
        ip: ftp.server_ip,
        port: ftp.ssh_port,
        username: ftp.ssh_user,
        password: ftp.ssh_pass
      });

      const result = await sshService.exec(`du -sb ${shellQuote(ftp.home_dir)} 2>/dev/null | cut -f1`, 15000);
      if (result.success && result.output) {
        usedSize = parseInt(result.output.trim(), 10) || 0;
      }
    }

    res.json({ id: ftp.id, used_size: usedSize });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 为子域名创建FTP账号
router.post('/', async (req, res) => {
  try {
    const { subdomain_id, username, password, port, home_dir, max_upload_size } = req.body;
    const ftpMaxUploadSize = Number(max_upload_size) > 0 ? Math.floor(Number(max_upload_size)) : 524288000;
    
    const ownedSub = await getAccessibleSubdomain(req, subdomain_id);
    if (!ownedSub) {
      return res.status(404).json({ error: 'Subdomain not found' });
    }

    // 获取子域名和服务器信息
    const subdomain = await db.get(`
      SELECT s.*, d.domain as main_domain, sv.id as server_id, sv.ip, sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass, sv.nginx_path
      FROM subdomains s 
      LEFT JOIN domains d ON s.domain_id = d.id 
      LEFT JOIN servers sv ON s.server_id = sv.id
      WHERE s.id = ?
    `, [subdomain_id]);
    
    if (!subdomain) {
      return res.status(404).json({ error: 'Subdomain not found' });
    }
    decryptFtpSecrets(subdomain);

    // 检查是否已有FTP账号
    const existing = await db.get('SELECT id FROM ftp_accounts WHERE subdomain_id = ?', [subdomain_id]);
    if (existing) {
      return res.status(400).json({ error: '该域名已有FTP账号' });
    }

    const ftpUsername = username || generateUsername(subdomain.subdomain, subdomain.main_domain);
    const ftpPassword = password || generatePassword();
    const fullDomain = `${subdomain.subdomain}.${subdomain.main_domain}`;
    const ftpHomeDir = home_dir || `/www/wwwroot/ftp/${fullDomain}`;

    // 如果有关联服务器，自动配置FTP
    let syncStatus = 'pending';
    let syncMessage = '';

    if (subdomain.server_id && subdomain.ip) {
      try {
        const sshService = new SshFtpService({
          ip: subdomain.ip,
          port: subdomain.ssh_port,
          username: subdomain.ssh_user,
          password: subdomain.ssh_pass
        });

        const result = await sshService.createFtpUser(ftpUsername, ftpPassword, ftpHomeDir);
        syncStatus = result.success ? 'synced' : 'error';
        syncMessage = result.message;

        if (result.success) {
          try {
            const { deployUploadScript, ensureSitePhpAfterDeploy } = require('../services/deploy-upload-script');
            await deployUploadScript(sshService, ftpHomeDir);
            const fullDomain = subdomain.subdomain === '@'
              ? subdomain.main_domain
              : `${subdomain.subdomain}.${subdomain.main_domain}`;
            await ensureSitePhpAfterDeploy(sshService, fullDomain, subdomain.nginx_path);
          } catch (deployErr) {
            console.error('下发直传脚本失败:', deployErr.message);
          }
        }
      } catch (err) {
        syncStatus = 'error';
        syncMessage = err.message;
      }
    }
    
    const result = await db.run(
      'INSERT INTO ftp_accounts (subdomain_id, username, password, port, home_dir, auth_code, status, sync_status, sync_message, max_upload_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [subdomain_id, ftpUsername, encryptSecret(ftpPassword), port || 21, ftpHomeDir, randomAuthCode(), 'active', syncStatus, syncMessage, ftpMaxUploadSize]
    );
    
    const newFtp = await db.get('SELECT auth_code FROM ftp_accounts WHERE id = ?', [result.lastID]);
    
    res.json({ 
      id: result.lastID, 
      username: ftpUsername, 
      password: ftpPassword,
      auth_code: newFtp.auth_code,
      sync_status: syncStatus,
      sync_message: syncMessage,
      message: 'FTP account created' 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 同步FTP账号到服务器
router.post('/:id/sync', async (req, res) => {
  try {
    if (!(await getAccessibleFtpAccount(req, req.params.id))) {
      return notFound(res, 'FTP account not found');
    }

    const ftp = await db.get(`
      SELECT f.*, s.subdomain, d.domain as main_domain, 
             sv.ip, sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass, sv.nginx_path
      FROM ftp_accounts f
      LEFT JOIN subdomains s ON f.subdomain_id = s.id
      LEFT JOIN domains d ON s.domain_id = d.id
      LEFT JOIN servers sv ON s.server_id = sv.id
      WHERE f.id = ?
    `, [req.params.id]);
    
    if (!ftp) {
      return res.status(404).json({ error: 'FTP account not found' });
    }
    decryptFtpSecrets(ftp);

    if (!ftp.ip) {
      return res.status(400).json({ error: '该域名未关联服务器' });
    }

    const sshService = new SshFtpService({
      ip: ftp.ip,
      port: ftp.ssh_port,
      username: ftp.ssh_user,
      password: ftp.ssh_pass
    });

    const result = await sshService.createFtpUser(ftp.username, ftp.password, ftp.home_dir);
    
    await db.run(
      'UPDATE ftp_accounts SET sync_status = ?, sync_message = ? WHERE id = ?',
      [result.success ? 'synced' : 'error', result.message, req.params.id]
    );

    if (result.success) {
      try {
        const { deployUploadScript, ensureSitePhpAfterDeploy } = require('../services/deploy-upload-script');
        await deployUploadScript(sshService, ftp.home_dir);
        const fullDomain = ftp.subdomain === '@'
          ? ftp.main_domain
          : `${ftp.subdomain}.${ftp.main_domain}`;
        await ensureSitePhpAfterDeploy(sshService, fullDomain, ftp.nginx_path);
      } catch (deployErr) {
        console.error('下发直传脚本失败:', deployErr.message);
      }
    }
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 更新FTP账号
router.put('/:id', async (req, res) => {
  try {
    if (!(await getAccessibleFtpAccount(req, req.params.id))) {
      return notFound(res, 'FTP account not found');
    }

    const { username, password, port, home_dir, max_upload_size, status } = req.body;
    const ftpMaxUploadSize = Number(max_upload_size) > 0 ? Math.floor(Number(max_upload_size)) : 524288000;
    
    let sql = 'UPDATE ftp_accounts SET username = ?, port = ?, home_dir = ?, max_upload_size = ?, status = ?';
    const params = [username, port || 21, home_dir, ftpMaxUploadSize, status || 'active'];
    
    if (password) {
      sql += ', password = ?, sync_status = ?';
      params.push(encryptSecret(password), 'pending');
    }
    
    sql += ' WHERE id = ?';
    params.push(req.params.id);
    
    await db.run(sql, params);
    res.json({ message: 'FTP account updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 重置授权码（随机生成，旧码立即失效）
router.post('/:id/reset-auth-code', async (req, res) => {
  try {
    const ftp = await getAccessibleFtpAccount(req, req.params.id);
    
    if (!ftp) {
      return res.status(404).json({ error: 'FTP account not found' });
    }
    
    const authCode = randomAuthCode();
    await db.run('UPDATE ftp_accounts SET auth_code = ? WHERE id = ?', [authCode, req.params.id]);
    await writeAudit({
      req,
      action: 'ftp.reset_auth_code',
      resource: 'ftp_account',
      resourceId: req.params.id
    });
    res.json({ auth_code: authCode, message: '授权码已重置，旧授权码立即失效' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 重置密码
router.post('/:id/reset-password', async (req, res) => {
  try {
    if (!(await getAccessibleFtpAccount(req, req.params.id))) {
      return notFound(res, 'FTP account not found');
    }

    const newPassword = generatePassword();
    
    const ftp = await db.get(`
      SELECT f.*, sv.ip, sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass
      FROM ftp_accounts f
      LEFT JOIN subdomains s ON f.subdomain_id = s.id
      LEFT JOIN servers sv ON s.server_id = sv.id
      WHERE f.id = ?
    `, [req.params.id]);
    
    if (!ftp) {
      return res.status(404).json({ error: 'FTP account not found' });
    }
    decryptFtpSecrets(ftp);

    // 同步到服务器
    let syncStatus = 'pending';
    let syncMessage = '';

    if (ftp.ip) {
      try {
        const sshService = new SshFtpService({
          ip: ftp.ip,
          port: ftp.ssh_port,
          username: ftp.ssh_user,
          password: ftp.ssh_pass
        });

        const result = await sshService.changePassword(ftp.username, newPassword);
        syncStatus = result.success ? 'synced' : 'error';
        syncMessage = result.message;
      } catch (err) {
        syncStatus = 'error';
        syncMessage = err.message;
      }
    }

    await db.run(
      'UPDATE ftp_accounts SET password = ?, sync_status = ?, sync_message = ? WHERE id = ?',
      [encryptSecret(newPassword), syncStatus, syncMessage, req.params.id]
    );
    
    await writeAudit({
      req,
      action: 'ftp.reset_password',
      resource: 'ftp_account',
      resourceId: req.params.id,
      detail: { sync_status: syncStatus }
    });
    res.json({ password: newPassword, sync_status: syncStatus, message: 'Password reset' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除FTP账号
router.delete('/:id', async (req, res) => {
  try {
    if (!(await getAccessibleFtpAccount(req, req.params.id))) {
      return notFound(res, 'FTP account not found');
    }

    const ftp = await db.get(`
      SELECT f.*, sv.ip, sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass
      FROM ftp_accounts f
      LEFT JOIN subdomains s ON f.subdomain_id = s.id
      LEFT JOIN servers sv ON s.server_id = sv.id
      WHERE f.id = ?
    `, [req.params.id]);
    
    if (ftp && ftp.ip) {
      try {
        decryptFtpSecrets(ftp);
        const sshService = new SshFtpService({
          ip: ftp.ip,
          port: ftp.ssh_port,
          username: ftp.ssh_user,
          password: ftp.ssh_pass
        });

        await sshService.deleteFtpUser(ftp.username);
      } catch (err) {
        console.error('Delete FTP user error:', err);
      }
    }
    
    await db.run('DELETE FROM ftp_accounts WHERE id = ?', [req.params.id]);
    await writeAudit({
      req,
      action: 'ftp.delete',
      resource: 'ftp_account',
      resourceId: req.params.id,
      detail: { username: ftp?.username }
    });
    res.json({ message: 'FTP account deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取没有FTP账号的子域名列表
router.get('/available-subdomains', async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? null : req.user.id;
    let sql = `
      SELECT s.id, s.subdomain, d.domain as main_domain,
             CASE WHEN s.subdomain = '@' THEN d.domain ELSE ${db.concat('s.subdomain', `'.'`, 'd.domain')} END as full_domain
      FROM subdomains s
      LEFT JOIN domains d ON s.domain_id = d.id
      LEFT JOIN ftp_accounts f ON s.id = f.subdomain_id
      WHERE f.id IS NULL
    `;
    
    if (userId) {
      sql += ' AND d.user_id = ?';
    }
    
    const subdomains = await db.all(sql, userId ? [userId] : []);
    res.json(subdomains);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
