const express = require('express');
const crypto = require('crypto');
const db = require('../db/database');
const { authMiddleware } = require('../middleware/auth');
const SshFtpService = require('../services/ssh-ftp');

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

// 生成授权码 (域名MD5完整32位小写)
function generateAuthCode(domain) {
  return crypto.createHash('md5').update(domain).digest('hex').toLowerCase();
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

// 获取FTP账号列表
router.get('/', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 10, 1), 100);
    const offset = (page - 1) * pageSize;
    
    const userId = req.user.role === 'admin' ? null : req.user.id;
    
    // 获取总数
    let countSql = `
      SELECT COUNT(*) as total
      FROM ftp_accounts f
      LEFT JOIN subdomains s ON f.subdomain_id = s.id
      LEFT JOIN domains d ON s.domain_id = d.id
    `;
    
    if (userId) {
      countSql += ' WHERE d.user_id = ?';
    }
    
    const countResult = await db.get(countSql, userId ? [userId] : []);
    const total = countResult?.total || 0;
    
    // 获取分页数据
    let sql = `
      SELECT f.*, s.subdomain, d.domain as main_domain, sv.name as server_name, sv.ip as server_ip,
             sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass,
             CASE WHEN s.subdomain = '@' THEN d.domain ELSE ${db.concat('s.subdomain', `'.'`, 'd.domain')} END as full_domain
      FROM ftp_accounts f
      LEFT JOIN subdomains s ON f.subdomain_id = s.id
      LEFT JOIN domains d ON s.domain_id = d.id
      LEFT JOIN servers sv ON s.server_id = sv.id
    `;
    
    if (userId) {
      sql += ' WHERE d.user_id = ?';
    }
    
    sql += ' ORDER BY f.created_at DESC LIMIT ? OFFSET ?';
    
    const params = userId ? [userId, pageSize, offset] : [pageSize, offset];
    const accounts = await db.all(sql, params);
    
    // 列表接口只返回数据库信息，空间统计由单独接口异步获取，避免每行 SSH 阻塞列表响应。
    for (const acc of accounts) {
      acc.auth_code = generateAuthCode(acc.full_domain);
      acc.used_size = null;
    }
    
    res.json({ 
      list: accounts, 
      total, 
      page, 
      pageSize
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
    const { subdomain_id, username, password, port, home_dir } = req.body;
    
    // 获取子域名和服务器信息
    const subdomain = await db.get(`
      SELECT s.*, d.domain as main_domain, sv.id as server_id, sv.ip, sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass
      FROM subdomains s 
      LEFT JOIN domains d ON s.domain_id = d.id 
      LEFT JOIN servers sv ON s.server_id = sv.id
      WHERE s.id = ?
    `, [subdomain_id]);
    
    if (!subdomain) {
      return res.status(400).json({ error: 'Subdomain not found' });
    }
    
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
      } catch (err) {
        syncStatus = 'error';
        syncMessage = err.message;
      }
    }
    
    const result = await db.run(
      'INSERT INTO ftp_accounts (subdomain_id, username, password, port, home_dir, auth_code, status, sync_status, sync_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [subdomain_id, ftpUsername, ftpPassword, port || 21, ftpHomeDir, generateAuthCode(fullDomain), 'active', syncStatus, syncMessage]
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
    const ftp = await db.get(`
      SELECT f.*, s.subdomain, d.domain as main_domain, 
             sv.ip, sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass
      FROM ftp_accounts f
      LEFT JOIN subdomains s ON f.subdomain_id = s.id
      LEFT JOIN domains d ON s.domain_id = d.id
      LEFT JOIN servers sv ON s.server_id = sv.id
      WHERE f.id = ?
    `, [req.params.id]);
    
    if (!ftp) {
      return res.status(404).json({ error: 'FTP account not found' });
    }
    
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
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 更新FTP账号
router.put('/:id', async (req, res) => {
  try {
    const { username, password, port, home_dir, max_upload_size, status } = req.body;
    
    let sql = 'UPDATE ftp_accounts SET username = ?, port = ?, home_dir = ?, max_upload_size = ?, status = ?';
    const params = [username, port || 21, home_dir, max_upload_size || 524288000, status || 'active'];
    
    if (password) {
      sql += ', password = ?, sync_status = ?';
      params.push(password, 'pending');
    }
    
    sql += ' WHERE id = ?';
    params.push(req.params.id);
    
    await db.run(sql, params);
    res.json({ message: 'FTP account updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 重置授权码 (实际上授权码是域名MD5，不需要重置，这里只是返回当前值)
router.post('/:id/reset-auth-code', async (req, res) => {
  try {
    // 获取域名信息
    const ftp = await db.get(`
      SELECT f.*, s.subdomain, d.domain as main_domain,
             CASE WHEN s.subdomain = '@' THEN d.domain ELSE ${db.concat('s.subdomain', `'.'`, 'd.domain')} END as full_domain
      FROM ftp_accounts f
      LEFT JOIN subdomains s ON f.subdomain_id = s.id
      LEFT JOIN domains d ON s.domain_id = d.id
      WHERE f.id = ?
    `, [req.params.id]);
    
    if (!ftp) {
      return res.status(404).json({ error: 'FTP account not found' });
    }
    
    // 授权码是域名MD5，固定不变
    const authCode = generateAuthCode(ftp.full_domain);
    res.json({ auth_code: authCode, message: '授权码为域名MD5，固定不变' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 重置密码
router.post('/:id/reset-password', async (req, res) => {
  try {
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
      [newPassword, syncStatus, syncMessage, req.params.id]
    );
    
    res.json({ password: newPassword, sync_status: syncStatus, message: 'Password reset' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除FTP账号
router.delete('/:id', async (req, res) => {
  try {
    const ftp = await db.get(`
      SELECT f.*, sv.ip, sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass
      FROM ftp_accounts f
      LEFT JOIN subdomains s ON f.subdomain_id = s.id
      LEFT JOIN servers sv ON s.server_id = sv.id
      WHERE f.id = ?
    `, [req.params.id]);
    
    if (ftp && ftp.ip) {
      try {
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
