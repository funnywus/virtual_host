const express = require('express');
const crypto = require('crypto');
const db = require('../db/database');
const { authMiddleware } = require('../middleware/auth');
const AliyunDns = require('../services/aliyun-dns');
const TencentDns = require('../services/tencent-dns');

const router = express.Router();

router.use(authMiddleware);

// 格式化时间为本地时间 YYYY-MM-DD HH:mm:ss
function formatTime(date = new Date()) {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 根据平台获取DNS服务实例
function getDnsService(platform, accessKey, secretKey) {
  switch (platform) {
    case 'tencent':
      return new TencentDns(accessKey, secretKey);
    case 'aliyun':
    default:
      return new AliyunDns(accessKey, secretKey);
  }
}

// 生成子域名（支持自定义前缀、后缀、总长度）
async function generateSubdomain(options = {}) {
  const { prefix = 'ly', suffix = '', totalLength = 8 } = options;
  const chars = 'abcdefghjkmnpqrstuvwxyz';
  let attempts = 0;
  const maxAttempts = 100;
  
  // 计算随机部分长度
  const randomLength = Math.max(1, totalLength - prefix.length - suffix.length);
  
  while (attempts < maxAttempts) {
    let randomPart = '';
    for (let i = 0; i < randomLength; i++) {
      randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const subdomain = prefix + randomPart + suffix;
    
    // 检查是否已存在
    const existing = await db.get('SELECT id FROM subdomains WHERE subdomain = ?', [subdomain]);
    if (!existing) {
      return subdomain;
    }
    attempts++;
  }
  
  // 如果尝试多次仍重复，加上时间戳后缀
  return prefix + Date.now().toString(36).slice(-randomLength) + suffix;
}

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

// 生成FTP用户名
function generateUsername(subdomain, domain) {
  const base = subdomain === '@' ? domain.split('.')[0] : subdomain;
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${base}_${suffix}`.substring(0, 16);
}

// ========== 主域名管理 ==========

// 获取主域名列表
router.get('/domains', async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? null : req.user.id;
    const sql = userId
      ? 'SELECT d.*, ac.name as aliyun_name FROM domains d LEFT JOIN aliyun_config ac ON d.aliyun_config_id = ac.id WHERE d.user_id = ?'
      : 'SELECT d.*, u.username, ac.name as aliyun_name FROM domains d LEFT JOIN users u ON d.user_id = u.id LEFT JOIN aliyun_config ac ON d.aliyun_config_id = ac.id';
    const domains = await db.all(sql, userId ? [userId] : []);
    res.json(domains);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 从DNS平台获取域名的解析记录列表
router.get('/domains/:id/dns-records', async (req, res) => {
  try {
    const domain = await db.get('SELECT d.*, ac.access_key, ac.secret_key, ac.platform FROM domains d LEFT JOIN aliyun_config ac ON d.aliyun_config_id = ac.id WHERE d.id = ?', [req.params.id]);
    
    if (!domain) {
      return res.status(404).json({ error: '域名不存在' });
    }
    
    if (!domain.access_key || !domain.secret_key) {
      return res.status(400).json({ error: '该域名未配置DNS平台' });
    }
    
    const dns = getDnsService(domain.platform, domain.access_key, domain.secret_key);
    
    let records = [];
    if (domain.platform === 'tencent') {
      const result = await dns.request('DescribeRecordList', { Domain: domain.domain, Limit: 500 });
      records = (result.RecordList || []).map(r => ({
        id: r.RecordId,
        name: r.Name,
        type: r.Type,
        value: r.Value,
        ttl: r.TTL,
        status: r.Status === 'ENABLE' ? 'active' : 'disabled',
        line: r.Line
      }));
    } else {
      const result = await dns.getRecords(domain.domain);
      records = (result.DomainRecords?.Record || []).map(r => ({
        id: r.RecordId,
        name: r.RR,
        type: r.Type,
        value: r.Value,
        ttl: r.TTL,
        status: r.Status === 'ENABLE' ? 'active' : 'disabled',
        line: r.Line
      }));
    }
    
    res.json({ domain: domain.domain, platform: domain.platform, records });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 添加DNS记录到平台
router.post('/domains/:id/dns-records', async (req, res) => {
  try {
    const { name, type, value, ttl } = req.body;
    const domain = await db.get('SELECT d.*, ac.access_key, ac.secret_key, ac.platform FROM domains d LEFT JOIN aliyun_config ac ON d.aliyun_config_id = ac.id WHERE d.id = ?', [req.params.id]);
    
    if (!domain || !domain.access_key) {
      return res.status(400).json({ error: '域名未配置DNS平台' });
    }
    
    const dns = getDnsService(domain.platform, domain.access_key, domain.secret_key);
    const recordId = await dns.addRecord(domain.domain, name, value, type || 'A', ttl || 600);
    
    res.json({ success: true, recordId, message: '添加成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除DNS平台上的记录
router.delete('/domains/:id/dns-records/:recordId', async (req, res) => {
  try {
    const domain = await db.get('SELECT d.*, ac.access_key, ac.secret_key, ac.platform FROM domains d LEFT JOIN aliyun_config ac ON d.aliyun_config_id = ac.id WHERE d.id = ?', [req.params.id]);
    
    if (!domain || !domain.access_key) {
      return res.status(400).json({ error: '域名未配置DNS平台' });
    }
    
    const dns = getDnsService(domain.platform, domain.access_key, domain.secret_key);
    
    if (domain.platform === 'tencent') {
      await dns.deleteRecord(domain.domain, req.params.recordId);
    } else {
      await dns.deleteRecord(req.params.recordId);
    }
    
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 修改DNS记录状态（启用/停用）
router.put('/domains/:id/dns-records/:recordId/status', async (req, res) => {
  try {
    const { status } = req.body; // 'ENABLE' or 'DISABLE'
    const domain = await db.get('SELECT d.*, ac.access_key, ac.secret_key, ac.platform FROM domains d LEFT JOIN aliyun_config ac ON d.aliyun_config_id = ac.id WHERE d.id = ?', [req.params.id]);
    
    if (!domain || !domain.access_key) {
      return res.status(400).json({ error: '域名未配置DNS平台' });
    }
    
    const dns = getDnsService(domain.platform, domain.access_key, domain.secret_key);
    
    if (domain.platform === 'tencent') {
      await dns.request('ModifyRecordStatus', {
        Domain: domain.domain,
        RecordId: parseInt(req.params.recordId),
        Status: status
      });
    } else {
      await dns.request('SetDomainRecordStatus', {
        RecordId: req.params.recordId,
        Status: status
      });
    }
    
    res.json({ success: true, message: status === 'ENABLE' ? '已启用' : '已停用' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 添加主域名
router.post('/domains', async (req, res) => {
  try {
    const { domain, aliyun_config_id, tags } = req.body;
    const result = await db.run(
      'INSERT INTO domains (domain, user_id, aliyun_config_id, tags) VALUES (?, ?, ?, ?)',
      [domain, req.user.id, aliyun_config_id || null, tags || '']
    );
    res.json({ id: result.lastID, message: 'Domain added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 更新主域名
router.put('/domains/:id', async (req, res) => {
  try {
    const { aliyun_config_id, tags } = req.body;
    await db.run('UPDATE domains SET aliyun_config_id = ?, tags = ? WHERE id = ?', [aliyun_config_id || null, tags || '', req.params.id]);
    res.json({ message: 'Domain updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除主域名
router.delete('/domains/:id', async (req, res) => {
  try {
    // 获取域名及其DNS配置
    const domain = await db.get('SELECT d.*, ac.access_key, ac.secret_key, ac.platform FROM domains d LEFT JOIN aliyun_config ac ON d.aliyun_config_id = ac.id WHERE d.id = ?', [req.params.id]);
    
    // 先删除所有子域名的DNS记录
    const subdomains = await db.all('SELECT * FROM subdomains WHERE domain_id = ?', [req.params.id]);
    
    if (domain && domain.access_key && domain.secret_key) {
      const dns = getDnsService(domain.platform, domain.access_key, domain.secret_key);
      for (const sub of subdomains) {
        if (sub.aliyun_record_id) {
          try { 
            if (domain.platform === 'tencent') {
              await dns.deleteRecord(domain.domain, sub.aliyun_record_id);
            } else {
              await dns.deleteRecord(sub.aliyun_record_id);
            }
          } catch (e) {}
        }
      }
    }
    
    await db.run('DELETE FROM subdomains WHERE domain_id = ?', [req.params.id]);
    await db.run('DELETE FROM domains WHERE id = ?', [req.params.id]);
    res.json({ message: 'Domain deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 设置默认域名
router.post('/domains/:id/set-default', async (req, res) => {
  try {
    await db.run('UPDATE domains SET is_default = 0 WHERE user_id = ?', [req.user.id]);
    await db.run('UPDATE domains SET is_default = 1 WHERE id = ?', [req.params.id]);
    res.json({ message: '已设为默认' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== 子域名管理 ==========

// 生成随机子域名
router.get('/generate-subdomain', async (req, res) => {
  try {
    const { prefix = 'ly', suffix = '', length = '8' } = req.query;
    const subdomain = await generateSubdomain({ 
      prefix, 
      suffix, 
      totalLength: parseInt(length) || 8 
    });
    res.json({ subdomain });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 批量生成子域名
router.post('/batch-create', async (req, res) => {
  try {
    const { domain_id, server_id, count, record_type, ttl, auto_ftp, auto_nginx, nginx_type, prefix = 'ly', suffix = '', subdomain_length = 8, duration_days = 31 } = req.body;
    
    if (!domain_id || !count || count < 1 || count > 100) {
      return res.status(400).json({ error: '请选择域名并输入有效数量(1-100)' });
    }
    
    // 获取主域名及其阿里云配置
    const domain = await db.get('SELECT d.*, ac.access_key, ac.secret_key, ac.platform FROM domains d LEFT JOIN aliyun_config ac ON d.aliyun_config_id = ac.id WHERE d.id = ?', [domain_id]);
    if (!domain) {
      return res.status(400).json({ error: 'Domain not found' });
    }

    // 获取服务器信息
    let server = null;
    if (server_id) {
      server = await db.get('SELECT * FROM servers WHERE id = ?', [server_id]);
    }

    const results = [];
    const SshFtpService = require('../services/ssh-ftp');
    const nginxConfigService = require('../services/nginx-config');
    
    let sshService = null;
    if (server) {
      sshService = new SshFtpService({
        ip: server.ip,
        port: server.port,
        username: server.username,
        password: server.password
      });
    }

    for (let i = 0; i < count; i++) {
      try {
        const subdomain = await generateSubdomain({ prefix, suffix, totalLength: subdomain_length });
        const fullDomain = `${subdomain}.${domain.domain}`;
        const finalValue = server ? server.ip : '';
        const ftpHomeDir = `/www/wwwroot/ftp/${fullDomain}`;

        // 创建子域名记录（包含有效期天数）
        const result = await db.run(
          `INSERT INTO subdomains (domain_id, subdomain, server_id, record_type, record_value, ttl, duration_days, created_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [domain_id, subdomain, server_id || null, record_type || 'A', finalValue, ttl || 600, duration_days || 31, formatTime()]
        );

        const subdomainId = result.lastID;
        let ftpInfo = null;

        // 自动创建FTP账号
        if (auto_ftp !== false && server) {
          const ftpUsername = generateUsername(subdomain, domain.domain);
          const ftpPassword = generatePassword();
          const ftpAuthCode = generateAuthCode(fullDomain);
          
          await db.run(
            'INSERT INTO ftp_accounts (subdomain_id, username, password, port, home_dir, auth_code, status, sync_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [subdomainId, ftpUsername, ftpPassword, 21, ftpHomeDir, ftpAuthCode, 'active', 'pending']
          );
          
          ftpInfo = { username: ftpUsername, password: ftpPassword, auth_code: ftpAuthCode, home_dir: ftpHomeDir };

          // 同步FTP到服务器
          if (sshService) {
            try {
              const ftpResult = await sshService.createFtpUser(ftpUsername, ftpPassword, ftpHomeDir);
              await db.run(
                'UPDATE ftp_accounts SET sync_status = ?, sync_message = ? WHERE subdomain_id = ?',
                [ftpResult.success ? 'synced' : 'error', ftpResult.message, subdomainId]
              );
              ftpInfo.sync_status = ftpResult.success ? 'synced' : 'error';
            } catch (err) {
              ftpInfo.sync_status = 'error';
            }
          }
        }

        // 自动生成并同步Nginx配置
        if (auto_nginx !== false && server && sshService) {
          try {
            const configType = nginx_type || 'https';
            const config = nginxConfigService.generateConfig(configType, fullDomain, { 
              rootPath: ftpHomeDir,
              mainDomain: domain.domain
            });
            await db.run('UPDATE subdomains SET nginx_config = ? WHERE id = ?', [config, subdomainId]);

            const configPath = `/www/server/panel/vhost/nginx/${fullDomain}.conf`;
            const escapedConfig = config.replace(/'/g, "'\\''");
            await sshService.exec(`echo '${escapedConfig}' | sudo tee ${configPath}`);
            await db.run('UPDATE subdomains SET nginx_synced = 1 WHERE id = ?', [subdomainId]);
          } catch (err) {}
        }

        // 解析DNS
        if (domain.access_key && domain.secret_key && finalValue) {
          try {
            const dns = getDnsService(domain.platform, domain.access_key, domain.secret_key);
            const recordId = await dns.addRecord(domain.domain, subdomain, finalValue, record_type || 'A', ttl || 600);
            await db.run('UPDATE subdomains SET aliyun_record_id = ?, status = ? WHERE id = ?', [recordId, 'active', subdomainId]);
          } catch (dnsErr) {
            await db.run('UPDATE subdomains SET status = ? WHERE id = ?', ['dns_error', subdomainId]);
          }
        }

        results.push({
          subdomain: fullDomain,
          ftp: ftpInfo,
          success: true
        });
      } catch (err) {
        results.push({
          subdomain: '',
          error: err.message,
          success: false
        });
      }
    }

    // 重载Nginx
    if (sshService) {
      try {
        await sshService.exec('sudo nginx -s reload 2>&1 || sudo systemctl reload nginx');
      } catch (err) {}
    }

    res.json({ 
      total: count,
      success: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取子域名列表
router.get('/subdomains', async (req, res) => {
  try {
    const { domain_id, page = 1, pageSize = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(pageSize);
    
    let whereSql = '';
    const params = [];
    
    if (domain_id) {
      whereSql = ' WHERE s.domain_id = ?';
      params.push(domain_id);
    } else if (req.user.role !== 'admin') {
      whereSql = ' WHERE d.user_id = ?';
      params.push(req.user.id);
    }
    
    // 获取总数
    const countSql = `SELECT COUNT(*) as total FROM subdomains s LEFT JOIN domains d ON s.domain_id = d.id ${whereSql}`;
    const countResult = await db.get(countSql, params);
    const total = countResult?.total || 0;
    
    // 获取分页数据
    const sql = `
      SELECT s.*, d.domain as main_domain, sv.name as server_name, sv.ip as server_ip,
             f.auth_code as ftp_auth_code
      FROM subdomains s 
      LEFT JOIN domains d ON s.domain_id = d.id 
      LEFT JOIN servers sv ON s.server_id = sv.id
      LEFT JOIN ftp_accounts f ON f.subdomain_id = s.id
      ${whereSql}
      ORDER BY s.created_at DESC
      LIMIT ? OFFSET ?
    `;
    
    const subdomains = await db.all(sql, [...params, parseInt(pageSize), offset]);
    res.json({ list: subdomains, total, page: parseInt(page), pageSize: parseInt(pageSize) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 更新子域名使用状态
router.put('/subdomains/:id/status', async (req, res) => {
  try {
    const { use_status, duration_months } = req.body;
    const sub = await db.get(`
      SELECT s.*, d.domain as main_domain, ac.access_key, ac.secret_key, ac.platform 
      FROM subdomains s 
      LEFT JOIN domains d ON s.domain_id = d.id 
      LEFT JOIN aliyun_config ac ON d.aliyun_config_id = ac.id 
      WHERE s.id = ?
    `, [req.params.id]);
    
    if (!sub) {
      return res.status(404).json({ error: 'Subdomain not found' });
    }

    // 如果是停用，删除DNS记录
    if (use_status === 'disabled') {
      if (sub.aliyun_record_id && sub.access_key && sub.secret_key) {
        const dns = getDnsService(sub.platform, sub.access_key, sub.secret_key);
        try {
          if (sub.platform === 'tencent') {
            await dns.deleteRecord(sub.main_domain, sub.aliyun_record_id);
          } else {
            await dns.deleteRecord(sub.aliyun_record_id);
          }
        } catch (e) {
          console.error('Delete DNS error:', e);
        }
      }
      await db.run('UPDATE subdomains SET use_status = ?, aliyun_record_id = NULL, status = ? WHERE id = ?', 
        [use_status, 'disabled', req.params.id]);
    } 
    // 如果是启用（从停用恢复），重新添加DNS记录
    else if ((use_status === 'unused' || use_status === 'used') && sub.use_status === 'disabled') {
      if (sub.access_key && sub.secret_key && sub.record_value) {
        const dns = getDnsService(sub.platform, sub.access_key, sub.secret_key);
        try {
          const recordId = await dns.addRecord(sub.main_domain, sub.subdomain, sub.record_value, sub.record_type || 'A', sub.ttl || 600);
          await db.run('UPDATE subdomains SET use_status = ?, aliyun_record_id = ?, status = ? WHERE id = ?', 
            [use_status, recordId, 'active', req.params.id]);
        } catch (e) {
          console.error('Add DNS error:', e);
          await db.run('UPDATE subdomains SET use_status = ?, status = ? WHERE id = ?', 
            [use_status, 'dns_error', req.params.id]);
        }
      } else {
        await db.run('UPDATE subdomains SET use_status = ? WHERE id = ?', [use_status, req.params.id]);
      }
    } else {
      await db.run('UPDATE subdomains SET use_status = ? WHERE id = ?', [use_status, req.params.id]);
    }

    // 如果设置了时长，计算到期时间
    if (duration_months && duration_months > 0) {
      const expireAt = new Date();
      expireAt.setMonth(expireAt.getMonth() + duration_months);
      const expireStr = expireAt.toISOString().slice(0, 19).replace('T', ' ');
      await db.run('UPDATE subdomains SET duration_months = ?, expire_at = ? WHERE id = ?', 
        [duration_months, expireStr, req.params.id]);
    }

    res.json({ message: 'Status updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 续费子域名
router.post('/subdomains/:id/renew', async (req, res) => {
  try {
    const { duration_months } = req.body;
    if (!duration_months || duration_months < 1) {
      return res.status(400).json({ error: '请选择续费时长' });
    }

    const sub = await db.get('SELECT * FROM subdomains WHERE id = ?', [req.params.id]);
    if (!sub) {
      return res.status(404).json({ error: 'Subdomain not found' });
    }

    // 计算新的到期时间（从当前到期时间或现在开始）
    let baseDate = new Date();
    if (sub.expire_at && new Date(sub.expire_at) > baseDate) {
      baseDate = new Date(sub.expire_at);
    }
    baseDate.setMonth(baseDate.getMonth() + duration_months);
    const expireStr = baseDate.toISOString().slice(0, 19).replace('T', ' ');

    await db.run('UPDATE subdomains SET expire_at = ?, use_status = CASE WHEN use_status = ? THEN ? ELSE use_status END WHERE id = ?', 
      [expireStr, 'disabled', 'unused', req.params.id]);

    res.json({ message: '续费成功', expire_at: expireStr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 检查并处理过期子域名（定时任务调用）
router.post('/subdomains/check-expire', async (req, res) => {
  try {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    // 获取所有已过期但未停用的子域名
    const expiredSubs = await db.all(`
      SELECT s.*, d.domain as main_domain, ac.access_key, ac.secret_key, ac.platform 
      FROM subdomains s 
      LEFT JOIN domains d ON s.domain_id = d.id 
      LEFT JOIN aliyun_config ac ON d.aliyun_config_id = ac.id 
      WHERE s.expire_at IS NOT NULL AND s.expire_at < ? AND s.use_status != 'disabled'
    `, [now]);

    let disabled = 0;
    for (const sub of expiredSubs) {
      // 删除DNS记录
      if (sub.aliyun_record_id && sub.access_key && sub.secret_key) {
        const dns = getDnsService(sub.platform, sub.access_key, sub.secret_key);
        try {
          if (sub.platform === 'tencent') {
            await dns.deleteRecord(sub.main_domain, sub.aliyun_record_id);
          } else {
            await dns.deleteRecord(sub.aliyun_record_id);
          }
        } catch (e) {}
      }
      
      await db.run('UPDATE subdomains SET use_status = ?, aliyun_record_id = NULL, status = ? WHERE id = ?', 
        ['disabled', 'disabled', sub.id]);
      disabled++;
    }

    res.json({ message: `已处理 ${disabled} 个过期子域名`, disabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 添加子域名并解析DNS
router.post('/subdomains', async (req, res) => {
  try {
    const { domain_id, subdomain, server_id, record_type, record_value, ttl, auto_ftp, auto_nginx, nginx_type, duration_days = 31 } = req.body;
    
    // 获取主域名及其阿里云配置
    const domain = await db.get('SELECT d.*, ac.access_key, ac.secret_key, ac.platform FROM domains d LEFT JOIN aliyun_config ac ON d.aliyun_config_id = ac.id WHERE d.id = ?', [domain_id]);
    if (!domain) {
      return res.status(400).json({ error: 'Domain not found' });
    }

    // 获取服务器信息
    let server = null;
    if (server_id) {
      server = await db.get('SELECT * FROM servers WHERE id = ?', [server_id]);
    }

    // 确定记录值
    let finalValue = record_value;
    if (server && record_type === 'A') {
      finalValue = server.ip;
    }

    const fullDomain = subdomain === '@' ? domain.domain : `${subdomain}.${domain.domain}`;

    // 创建子域名记录（包含有效期天数）
    const result = await db.run(
      `INSERT INTO subdomains (domain_id, subdomain, server_id, record_type, record_value, ttl, duration_days, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [domain_id, subdomain, server_id || null, record_type || 'A', finalValue, ttl || 600, duration_days || 31, formatTime()]
    );

    const subdomainId = result.lastID;
    let ftpInfo = null;
    let nginxSynced = false;
    const ftpHomeDir = `/www/wwwroot/ftp/${fullDomain}`;

    // 自动创建FTP账号并同步（默认开启，需要关联服务器）
    if (auto_ftp !== false && server) {
      const ftpUsername = generateUsername(subdomain, domain.domain);
      const ftpPassword = generatePassword();
      const ftpAuthCode = generateAuthCode(fullDomain);
      
      // 保存FTP账号
      await db.run(
        'INSERT INTO ftp_accounts (subdomain_id, username, password, port, home_dir, auth_code, status, sync_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [subdomainId, ftpUsername, ftpPassword, 21, ftpHomeDir, ftpAuthCode, 'active', 'pending']
      );
      
      ftpInfo = { username: ftpUsername, password: ftpPassword, home_dir: ftpHomeDir, auth_code: ftpAuthCode };

      // 同步FTP到服务器
      try {
        const SshFtpService = require('../services/ssh-ftp');
        const sshService = new SshFtpService({
          ip: server.ip,
          port: server.port,
          username: server.username,
          password: server.password
        });
        
        const ftpResult = await sshService.createFtpUser(ftpUsername, ftpPassword, ftpHomeDir);
        await db.run(
          'UPDATE ftp_accounts SET sync_status = ?, sync_message = ? WHERE subdomain_id = ?',
          [ftpResult.success ? 'synced' : 'error', ftpResult.message, subdomainId]
        );
        ftpInfo.sync_status = ftpResult.success ? 'synced' : 'error';
      } catch (err) {
        console.error('FTP sync error:', err);
        ftpInfo.sync_status = 'error';
      }
    }

    // 自动生成并同步Nginx配置（默认开启，需要关联服务器）
    if (auto_nginx !== false && server) {
      try {
        const nginxConfigService = require('../services/nginx-config');
        const configType = nginx_type || 'https'; // 默认HTTPS
        const config = nginxConfigService.generateConfig(configType, fullDomain, { 
          rootPath: ftpHomeDir,
          mainDomain: domain.domain // 用于SSL证书路径
        });
        
        await db.run('UPDATE subdomains SET nginx_config = ? WHERE id = ?', [config, subdomainId]);

        const SshFtpService = require('../services/ssh-ftp');
        const sshService = new SshFtpService({
          ip: server.ip,
          port: server.port,
          username: server.username,
          password: server.password
        });

        const configPath = `/www/server/panel/vhost/nginx/${fullDomain}.conf`;
        const escapedConfig = config.replace(/'/g, "'\\''");
        await sshService.exec(`echo '${escapedConfig}' | sudo tee ${configPath}`);
        
        const testResult = await sshService.exec('sudo nginx -t 2>&1');
        if (testResult.success || testResult.output.includes('successful')) {
          await sshService.exec('sudo nginx -s reload 2>&1 || sudo systemctl reload nginx');
          await db.run('UPDATE subdomains SET nginx_synced = 1 WHERE id = ?', [subdomainId]);
          nginxSynced = true;
        }
      } catch (err) {
        console.error('Nginx sync error:', err);
      }
    }

    // 解析DNS
    if (domain.access_key && domain.secret_key && finalValue) {
      try {
        const dns = getDnsService(domain.platform, domain.access_key, domain.secret_key);
        const recordId = await dns.addRecord(domain.domain, subdomain, finalValue, record_type || 'A', ttl || 600);
        
        await db.run('UPDATE subdomains SET aliyun_record_id = ?, status = ? WHERE id = ?', 
          [recordId, 'active', subdomainId]);
      } catch (dnsErr) {
        console.error('DNS error:', dnsErr);
        await db.run('UPDATE subdomains SET status = ? WHERE id = ?', ['dns_error', subdomainId]);
      }
    }

    res.json({ 
      id: subdomainId, 
      ftp: ftpInfo, 
      nginx_synced: nginxSynced,
      message: 'Subdomain added' 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 只更新备注（不修改DNS解析）
router.put('/subdomains/:id/remark', async (req, res) => {
  try {
    const { remark } = req.body;
    const sub = await db.get('SELECT id FROM subdomains WHERE id = ?', [req.params.id]);
    if (!sub) {
      return res.status(404).json({ error: 'Subdomain not found' });
    }
    await db.run('UPDATE subdomains SET remark = ? WHERE id = ?', [remark || '', req.params.id]);
    res.json({ message: 'Remark updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 更新子域名
router.put('/subdomains/:id', async (req, res) => {
  try {
    const { server_id, record_type, record_value, ttl, remark } = req.body;
    const sub = await db.get(`
      SELECT s.*, d.domain as main_domain, ac.access_key, ac.secret_key, ac.platform 
      FROM subdomains s 
      LEFT JOIN domains d ON s.domain_id = d.id 
      LEFT JOIN aliyun_config ac ON d.aliyun_config_id = ac.id 
      WHERE s.id = ?
    `, [req.params.id]);
    
    if (!sub) {
      return res.status(404).json({ error: 'Subdomain not found' });
    }

    let finalValue = record_value;
    if (server_id && record_type === 'A') {
      const server = await db.get('SELECT ip FROM servers WHERE id = ?', [server_id]);
      if (server) finalValue = server.ip;
    }

    // 更新DNS（使用域名关联的配置）
    if (sub.access_key && sub.secret_key) {
      const dns = getDnsService(sub.platform, sub.access_key, sub.secret_key);
      
      // 删除旧记录
      if (sub.aliyun_record_id) {
        try { 
          if (sub.platform === 'tencent') {
            await dns.deleteRecord(sub.main_domain, sub.aliyun_record_id);
          } else {
            await dns.deleteRecord(sub.aliyun_record_id);
          }
        } catch (e) {}
      }
      
      // 添加新记录
      if (finalValue) {
        try {
          const recordId = await dns.addRecord(sub.main_domain, sub.subdomain, finalValue, record_type || 'A', ttl || 600);
          await db.run(
            `UPDATE subdomains SET server_id = ?, record_type = ?, record_value = ?, ttl = ?, remark = ?, aliyun_record_id = ?, status = ? WHERE id = ?`,
            [server_id || null, record_type || 'A', finalValue, ttl || 600, remark || '', recordId, 'active', req.params.id]
          );
          return res.json({ message: 'Subdomain updated' });
        } catch (dnsErr) {
          await db.run('UPDATE subdomains SET status = ? WHERE id = ?', ['dns_error', req.params.id]);
        }
      }
    }
    
    await db.run(
      `UPDATE subdomains SET server_id = ?, record_type = ?, record_value = ?, ttl = ?, remark = ? WHERE id = ?`,
      [server_id || null, record_type || 'A', finalValue, ttl || 600, remark || '', req.params.id]
    );

    res.json({ message: 'Subdomain updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除子域名
router.delete('/subdomains/:id', async (req, res) => {
  try {
    const sub = await db.get(`
      SELECT s.*, d.domain as main_domain, ac.access_key, ac.secret_key, ac.platform 
      FROM subdomains s 
      LEFT JOIN domains d ON s.domain_id = d.id 
      LEFT JOIN aliyun_config ac ON d.aliyun_config_id = ac.id 
      WHERE s.id = ?
    `, [req.params.id]);
    
    if (sub && sub.aliyun_record_id && sub.access_key && sub.secret_key) {
      const dns = getDnsService(sub.platform, sub.access_key, sub.secret_key);
      try { 
        if (sub.platform === 'tencent') {
          await dns.deleteRecord(sub.main_domain, sub.aliyun_record_id);
        } else {
          await dns.deleteRecord(sub.aliyun_record_id);
        }
      } catch (e) {}
    }
    
    // 删除关联的FTP账号
    await db.run('DELETE FROM ftp_accounts WHERE subdomain_id = ?', [req.params.id]);
    await db.run('DELETE FROM subdomains WHERE id = ?', [req.params.id]);
    res.json({ message: 'Subdomain deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== DNS平台配置（多个厂商） ==========

// 获取所有DNS平台配置
router.get('/aliyun-configs', async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? null : req.user.id;
    const sql = userId
      ? 'SELECT id, name, platform, access_key, remark, created_at FROM aliyun_config WHERE user_id = ?'
      : 'SELECT ac.id, ac.name, ac.platform, ac.access_key, ac.remark, ac.created_at, u.username FROM aliyun_config ac LEFT JOIN users u ON ac.user_id = u.id';
    const configs = await db.all(sql, userId ? [userId] : []);
    res.json(configs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 添加DNS平台配置
router.post('/aliyun-configs', async (req, res) => {
  try {
    const { name, platform, access_key, secret_key, remark, tags } = req.body;
    const result = await db.run(
      'INSERT INTO aliyun_config (user_id, name, platform, access_key, secret_key, remark, tags) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.user.id, name, platform || 'aliyun', access_key, secret_key, remark || '', tags || '']
    );
    res.json({ id: result.lastID, message: 'Config added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 更新DNS平台配置
router.put('/aliyun-configs/:id', async (req, res) => {
  try {
    const { name, platform, access_key, secret_key, remark, tags } = req.body;
    if (secret_key) {
      await db.run(
        'UPDATE aliyun_config SET name = ?, platform = ?, access_key = ?, secret_key = ?, remark = ?, tags = ? WHERE id = ?',
        [name, platform || 'aliyun', access_key, secret_key, remark || '', tags || '', req.params.id]
      );
    } else {
      await db.run(
        'UPDATE aliyun_config SET name = ?, platform = ?, access_key = ?, remark = ?, tags = ? WHERE id = ?',
        [name, platform || 'aliyun', access_key, remark || '', tags || '', req.params.id]
      );
    }
    res.json({ message: 'Config updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除DNS平台配置
router.delete('/aliyun-configs/:id', async (req, res) => {
  try {
    // 检查是否有域名在使用
    const using = await db.get('SELECT id FROM domains WHERE aliyun_config_id = ?', [req.params.id]);
    if (using) {
      return res.status(400).json({ error: '该配置正在被域名使用，无法删除' });
    }
    await db.run('DELETE FROM aliyun_config WHERE id = ?', [req.params.id]);
    res.json({ message: 'Config deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 设置默认DNS配置
router.post('/aliyun-configs/:id/set-default', async (req, res) => {
  try {
    await db.run('UPDATE aliyun_config SET is_default = 0 WHERE user_id = ?', [req.user.id]);
    await db.run('UPDATE aliyun_config SET is_default = 1 WHERE id = ?', [req.params.id]);
    res.json({ message: '已设为默认' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 测试DNS平台配置
router.post('/aliyun-configs/:id/test', async (req, res) => {
  try {
    const config = await db.get('SELECT * FROM aliyun_config WHERE id = ?', [req.params.id]);
    if (!config) {
      return res.status(404).json({ error: '配置不存在' });
    }
    
    const platform = config.platform || 'aliyun';
    
    try {
      if (platform === 'aliyun') {
        const dns = new AliyunDns(config.access_key, config.secret_key);
        await dns.request('DescribeDomains', { PageSize: 1 });
        res.json({ success: true, message: '阿里云DNS连接成功' });
      } else if (platform === 'tencent') {
        const dns = new TencentDns(config.access_key, config.secret_key);
        await dns.getDomainList();
        res.json({ success: true, message: '腾讯云DNS连接成功' });
      } else {
        res.json({ success: true, message: `${platform} 配置已保存（API测试待实现）` });
      }
    } catch (e) {
      res.json({ success: false, message: `连接失败: ${e.message}` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 兼容旧接口
router.post('/aliyun-config', async (req, res) => {
  try {
    const { access_key, secret_key } = req.body;
    const existing = await db.get('SELECT id FROM aliyun_config WHERE user_id = ?', [req.user.id]);
    
    if (existing) {
      await db.run('UPDATE aliyun_config SET access_key = ?, secret_key = ? WHERE id = ?',
        [access_key, secret_key, existing.id]);
    } else {
      await db.run('INSERT INTO aliyun_config (user_id, name, access_key, secret_key) VALUES (?, ?, ?, ?)',
        [req.user.id, '默认配置', access_key, secret_key]);
    }
    
    res.json({ message: 'Config saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/aliyun-config', async (req, res) => {
  try {
    const config = await db.get('SELECT * FROM aliyun_config WHERE user_id = ?', [req.user.id]);
    res.json(config || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== 兼容旧接口 ==========

router.get('/hosts', async (req, res) => {
  try {
    const subdomains = await db.all(`
      SELECT s.*, d.domain as main_domain, sv.name as server_name, sv.ip 
      FROM subdomains s 
      LEFT JOIN domains d ON s.domain_id = d.id 
      LEFT JOIN servers sv ON s.server_id = sv.id
      WHERE d.user_id = ?
    `, [req.user.id]);
    
    res.json(subdomains.map(s => ({
      ...s,
      domain: s.subdomain + '.' + s.main_domain,
      dns_status: s.status
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
