const express = require('express');
const db = require('../db/database');
const { authMiddleware } = require('../middleware/auth');
const SshFtpService = require('../services/ssh-ftp');
const sslCert = require('../services/ssl-cert');

const router = express.Router();

// 格式化时间为 YYYY-MM-DD HH:mm:ss
const formatTime = (date = new Date()) => {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// 解析 openssl 日期格式 (如 "Dec 26 08:11:49 2025 GMT") 为标准格式
const parseOpenSSLDate = (dateStr) => {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return formatTime(d);
  } catch (e) {
    return dateStr;
  }
};

const normalizeServerIds = (serverIds, serverId) => {
  const rawIds = Array.isArray(serverIds) ? serverIds : (serverId ? [serverId] : []);
  return [...new Set(rawIds.map(id => parseInt(id, 10)).filter(id => Number.isInteger(id) && id > 0))];
};

const getFallbackServer = async (domainId) => {
  const sub = await db.get(`
    SELECT sv.* FROM subdomains s
    LEFT JOIN servers sv ON s.server_id = sv.id
    WHERE s.domain_id = ? AND sv.id IS NOT NULL
    LIMIT 1
  `, [domainId]);
  
  return sub || await db.get('SELECT * FROM servers LIMIT 1');
};

const getIssueServers = async (domainId, serverIds) => {
  if (serverIds.length === 0) {
    const server = await getFallbackServer(domainId);
    return server ? [server] : [];
  }
  
  const servers = [];
  for (const serverId of serverIds) {
    const server = await db.get('SELECT * FROM servers WHERE id = ?', [serverId]);
    if (server) servers.push(server);
  }
  return servers;
};

const hasIssueSucceeded = (result) => (
  result.success ||
  result.output?.includes('Cert success') ||
  result.output?.includes('Installing cert') ||
  result.output?.includes('Your cert is in')
);

router.use(authMiddleware);

// 获取证书类型列表
router.get('/types', (req, res) => {
  res.json(sslCert.CERT_TYPES);
});

// 获取验证方式列表
router.get('/verify-methods', (req, res) => {
  res.json(sslCert.VERIFY_METHODS);
});

// 检查主域名证书状态
router.get('/status/:domain_id', async (req, res) => {
  try {
    const domain = await db.get(`
      SELECT d.*, a.access_key, a.secret_key, a.platform
      FROM domains d
      LEFT JOIN aliyun_config a ON d.aliyun_config_id = a.id
      WHERE d.id = ?
    `, [req.params.domain_id]);
    
    if (!domain) {
      return res.status(404).json({ error: '域名不存在' });
    }
    
    // 获取该域名下任意一个有服务器的子域名来检查证书
    const sub = await db.get(`
      SELECT s.*, sv.ip, sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass
      FROM subdomains s
      LEFT JOIN servers sv ON s.server_id = sv.id
      WHERE s.domain_id = ? AND sv.id IS NOT NULL
      LIMIT 1
    `, [req.params.domain_id]);
    
    // 如果没有子域名，尝试获取任意服务器
    let server = null;
    if (!sub || !sub.ip) {
      server = await db.get('SELECT * FROM servers LIMIT 1');
    }
    
    const paths = sslCert.getCertPath(domain.domain);
    const hasServer = !!(sub?.ip || server?.ip);
    
    if (!hasServer) {
      return res.json({
        exists: false,
        domain: domain.domain,
        paths,
        ssl_status: domain.ssl_status,
        ssl_type: domain.ssl_type,
        ssl_expires: domain.ssl_expires,
        ssl_log: domain.ssl_log,
        has_server: false,
        has_dns_config: !!domain.aliyun_config_id,
        platform: domain.platform
      });
    }
    
    const sshConfig = sub?.ip ? {
      ip: sub.ip,
      port: sub.ssh_port,
      username: sub.ssh_user,
      password: sub.ssh_pass
    } : {
      ip: server.ip,
      port: server.port,
      username: server.username,
      password: server.password
    };
    
    const sshService = new SshFtpService(sshConfig);
    
    const checkCmd = sslCert.getCheckCommand(domain.domain);
    const result = await sshService.exec(checkCmd);
    
    const output = result.output || '';
    const exists = output.includes('CERT_EXISTS=true');
    
    let notBefore = null, notAfter = null, issuer = null, san = null;
    
    if (exists) {
      const beforeMatch = output.match(/notBefore=(.+)/);
      const afterMatch = output.match(/notAfter=(.+)/);
      const issuerMatch = output.match(/issuer=(.+)/);
      const sanMatch = output.match(/DNS:([^\n]+)/);
      
      if (beforeMatch) notBefore = parseOpenSSLDate(beforeMatch[1].trim());
      if (afterMatch) notAfter = parseOpenSSLDate(afterMatch[1].trim());
      if (issuerMatch) issuer = issuerMatch[1].trim();
      if (sanMatch) san = sanMatch[1].trim();
    }
    
    res.json({
      exists,
      domain: domain.domain,
      wildcard: `*.${domain.domain}`,
      not_before: notBefore,
      not_after: notAfter,
      issuer,
      san,
      paths,
      ssl_status: domain.ssl_status,
      ssl_type: domain.ssl_type,
      ssl_expires: domain.ssl_expires,
      ssl_log: domain.ssl_log,
      has_server: true,
      has_dns_config: !!domain.aliyun_config_id,
      platform: domain.platform
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取可用服务器列表（用于选择申请证书的服务器）
router.get('/servers', async (req, res) => {
  try {
    const servers = await db.all('SELECT id, name, ip FROM servers');
    res.json(servers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取证书申请日志（用于实时轮询）
router.get('/log/:domain_id', async (req, res) => {
  try {
    const domain = await db.get('SELECT ssl_log, ssl_status FROM domains WHERE id = ?', [req.params.domain_id]);
    if (!domain) {
      return res.status(404).json({ error: '域名不存在' });
    }
    res.json({ log: domain.ssl_log || '', status: domain.ssl_status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 申请证书
router.post('/issue/:domain_id', async (req, res) => {
  try {
    const { cert_type, verify_method, server_id, server_ids, webroot } = req.body;
    const startTime = formatTime();
    let log = `[${startTime}] 开始申请证书\n`;
    const selectedServerIds = normalizeServerIds(server_ids, server_id);
    
    const domain = await db.get(`
      SELECT d.*, a.access_key, a.secret_key, a.platform
      FROM domains d
      LEFT JOIN aliyun_config a ON d.aliyun_config_id = a.id
      WHERE d.id = ?
    `, [req.params.domain_id]);
    
    if (!domain) {
      return res.status(404).json({ error: '域名不存在' });
    }
    
    const isWildcard = verify_method !== 'http' && verify_method !== 'standalone';
    log += `[${startTime}] 域名: ${domain.domain}${isWildcard ? ', *.' + domain.domain : ''}\n`;
    log += `[${startTime}] 证书类型: ${cert_type || 'letsencrypt'}\n`;
    log += `[${startTime}] 验证方式: ${verify_method || 'dns'}\n`;
    
    // DNS验证需要DNS配置
    if (isWildcard && (!domain.aliyun_config_id || !domain.access_key)) {
      log += `[${startTime}] 错误: 通配符证书需要DNS平台配置\n`;
      await db.run('UPDATE domains SET ssl_log = ? WHERE id = ?', [log, req.params.domain_id]);
      return res.status(400).json({ 
        error: '通配符证书必须使用DNS验证，请先为该域名配置DNS平台',
        log 
      });
    }
    
    const servers = await getIssueServers(req.params.domain_id, selectedServerIds);
    
    if (servers.length === 0) {
      log += `[${startTime}] 错误: 没有可用的服务器\n`;
      await db.run('UPDATE domains SET ssl_log = ? WHERE id = ?', [log, req.params.domain_id]);
      return res.status(400).json({ error: '请先添加服务器，或选择一个服务器来申请证书', log });
    }
    
    if (selectedServerIds.length > 0 && servers.length !== selectedServerIds.length) {
      const foundIds = new Set(servers.map(server => Number(server.id)));
      const missingIds = selectedServerIds.filter(id => !foundIds.has(id));
      log += `[${startTime}] 错误: 选中的服务器不存在: ${missingIds.join(', ')}\n`;
      await db.run('UPDATE domains SET ssl_log = ? WHERE id = ?', [log, req.params.domain_id]);
      return res.status(400).json({ error: '选中的服务器不存在，请刷新后重试', log });
    }
    
    log += `[${startTime}] 目标服务器: ${servers.map(server => `${server.name || server.ip} (${server.ip})`).join(', ')}\n`;
    
    // 更新状态为申请中
    log += `[${formatTime()}] 状态: 申请中...\n`;
    await db.run('UPDATE domains SET ssl_status = ?, ssl_type = ?, ssl_log = ? WHERE id = ?', 
      ['issuing', cert_type || 'letsencrypt', log, req.params.domain_id]);
    
    // 根据验证方式生成命令
    let issueCmd;
    if (verify_method === 'http') {
      log += `[${formatTime()}] 使用HTTP验证（仅主域名，不支持通配符）\n`;
      issueCmd = sslCert.getIssueHttpCommand(domain.domain, cert_type, webroot);
    } else if (verify_method === 'standalone') {
      log += `[${formatTime()}] 使用Standalone验证（会临时停止nginx）\n`;
      issueCmd = sslCert.getIssueStandaloneCommand(domain.domain, cert_type);
    } else {
      log += `[${formatTime()}] 使用DNS验证（支持通配符）\n`;
      log += `[${formatTime()}] DNS平台: ${domain.platform || 'aliyun'}\n`;
      issueCmd = sslCert.getIssueWildcardCommand(
        domain.domain, 
        cert_type, 
        domain.platform || 'aliyun',
        domain.access_key, 
        domain.secret_key
      );
    }
    
    log += `[${formatTime()}] 将在 ${servers.length} 台服务器上执行acme.sh申请命令\n`;
    await db.run('UPDATE domains SET ssl_log = ? WHERE id = ?', [log, req.params.domain_id]);
    
    const paths = sslCert.getCertPath(domain.domain);
    const results = [];
    let expiresAt = null;
    
    for (let index = 0; index < servers.length; index++) {
      const server = servers[index];
      const serverLabel = `${server.name || server.ip} (${server.ip})`;
      log += `\n[${formatTime()}] [${index + 1}/${servers.length}] 开始处理服务器: ${serverLabel}\n`;
      await db.run('UPDATE domains SET ssl_log = ? WHERE id = ?', [log, req.params.domain_id]);
      
      try {
        const sshService = new SshFtpService({
          ip: server.ip,
          port: server.port,
          username: server.username,
          password: server.password
        });
        
        // 先检查并安装 acme.sh
        const checkAcmeCmd = 'if [ -f ~/.acme.sh/acme.sh ]; then echo "ACME_INSTALLED"; else echo "ACME_NOT_INSTALLED"; fi';
        const checkResult = await sshService.exec(checkAcmeCmd);
        
        if (checkResult.output?.includes('ACME_NOT_INSTALLED')) {
          log += `[${formatTime()}] ${serverLabel}: 检测到未安装acme.sh，正在自动安装...\n`;
          await db.run('UPDATE domains SET ssl_log = ? WHERE id = ?', [log, req.params.domain_id]);
          
          const installCmd = sslCert.getInstallAcmeCommand('admin@' + domain.domain);
          const installResult = await sshService.exec(installCmd);
          
          if (!installResult.success && !installResult.output?.includes('acme.sh')) {
            log += `[${formatTime()}] ${serverLabel}: acme.sh安装失败\n`;
            log += `--- ${serverLabel} 安装输出 ---\n${installResult.output || '(无输出)'}\n--- 输出结束 ---\n`;
            results.push({ server: serverLabel, success: false, message: 'acme.sh安装失败' });
            await db.run('UPDATE domains SET ssl_log = ? WHERE id = ?', [log, req.params.domain_id]);
            continue;
          }
          
          log += `[${formatTime()}] ${serverLabel}: acme.sh安装成功\n`;
          await db.run('UPDATE domains SET ssl_log = ? WHERE id = ?', [log, req.params.domain_id]);
        }
        
        log += `[${formatTime()}] ${serverLabel}: 执行申请命令...\n`;
        await db.run('UPDATE domains SET ssl_log = ? WHERE id = ?', [log, req.params.domain_id]);
        
        const result = await sshService.exec(issueCmd);
        
        log += `[${formatTime()}] ${serverLabel}: 命令执行完成\n`;
        log += `--- ${serverLabel} 执行输出 ---\n${result.output || '(无输出)'}\n--- 输出结束 ---\n`;
        
        if (hasIssueSucceeded(result)) {
          // 获取证书信息
          const checkCmd = sslCert.getCheckCommand(domain.domain);
          const certCheckResult = await sshService.exec(checkCmd);
          
          const afterMatch = certCheckResult.output?.match(/notAfter=(.+)/);
          if (afterMatch && !expiresAt) {
            expiresAt = parseOpenSSLDate(afterMatch[1].trim());
          }
          
          log += `[${formatTime()}] ${serverLabel}: 证书申请成功\n`;
          log += `[${formatTime()}] ${serverLabel}: 过期时间: ${expiresAt || '未知'}\n`;
          results.push({ server: serverLabel, success: true, expires: expiresAt });
        } else {
          log += `[${formatTime()}] ${serverLabel}: 证书申请失败\n`;
          results.push({ server: serverLabel, success: false, message: '证书申请失败', output: result.output });
        }
      } catch (err) {
        log += `[${formatTime()}] ${serverLabel}: 异常错误: ${err.message}\n`;
        results.push({ server: serverLabel, success: false, message: err.message });
      }
      
      await db.run('UPDATE domains SET ssl_log = ? WHERE id = ?', [log, req.params.domain_id]);
    }
    
    const successCount = results.filter(result => result.success).length;
    const failedCount = results.length - successCount;
    
    log += `\n[${formatTime()}] 申请完成: 成功 ${successCount} 台，失败 ${failedCount} 台\n`;
    
    if (failedCount === 0) {
      log += `[${formatTime()}] 证书申请成功!\n`;
      await db.run('UPDATE domains SET ssl_status = ?, ssl_expires = ?, ssl_log = ? WHERE id = ?', 
        ['active', expiresAt, log, req.params.domain_id]);
      
      res.json({ 
        success: true, 
        message: isWildcard ? `通配符证书申请成功 (*.${domain.domain})` : `证书申请成功 (${domain.domain})`,
        paths,
        expires: expiresAt,
        results,
        log
      });
    } else {
      log += `[${formatTime()}] 证书申请失败，请查看各服务器日志\n`;
      
      await db.run('UPDATE domains SET ssl_status = ?, ssl_log = ? WHERE id = ?', ['error', log, req.params.domain_id]);
      res.json({ 
        success: false,
        message: successCount > 0 ? `部分服务器申请成功：成功 ${successCount} 台，失败 ${failedCount} 台` : '证书申请失败，请查看日志',
        results,
        log
      });
    }
  } catch (err) {
    const log = `[${formatTime()}] 异常错误: ${err.message}\n`;
    await db.run('UPDATE domains SET ssl_status = ?, ssl_log = ? WHERE id = ?', ['error', log, req.params.domain_id]);
    res.status(500).json({ error: err.message, log });
  }
});

// 续期证书
router.post('/renew/:domain_id', async (req, res) => {
  try {
    const startTime = formatTime();
    let log = `[${startTime}] 开始续期证书\n`;
    
    const domain = await db.get('SELECT * FROM domains WHERE id = ?', [req.params.domain_id]);
    
    if (!domain) {
      return res.status(404).json({ error: '域名不存在' });
    }
    
    log += `[${startTime}] 域名: ${domain.domain}\n`;
    
    // 获取服务器
    let server = await db.get(`
      SELECT sv.* FROM subdomains s
      LEFT JOIN servers sv ON s.server_id = sv.id
      WHERE s.domain_id = ? AND sv.id IS NOT NULL
      LIMIT 1
    `, [req.params.domain_id]);
    
    if (!server) {
      server = await db.get('SELECT * FROM servers LIMIT 1');
    }
    
    if (!server || !server.ip) {
      log += `[${startTime}] 错误: 没有可用的服务器\n`;
      await db.run('UPDATE domains SET ssl_log = ? WHERE id = ?', [log, req.params.domain_id]);
      return res.status(400).json({ error: '没有可用的服务器', log });
    }
    
    log += `[${startTime}] 目标服务器: ${server.name || server.ip} (${server.ip})\n`;
    
    const sshService = new SshFtpService({
      ip: server.ip,
      port: server.port,
      username: server.username,
      password: server.password
    });
    
    log += `[${formatTime()}] 状态: 续期中...\n`;
    await db.run('UPDATE domains SET ssl_status = ?, ssl_log = ? WHERE id = ?', ['renewing', log, req.params.domain_id]);
    
    // 检查是否是通配符证书
    const checkCmd = sslCert.getCheckCommand(domain.domain);
    const checkResult = await sshService.exec(checkCmd);
    const isWildcard = checkResult.output?.includes(`*.${domain.domain}`);
    
    const renewCmd = sslCert.getRenewCommand(domain.domain, isWildcard);
    const result = await sshService.exec(renewCmd);
    
    log += `[${formatTime()}] 命令执行完成\n`;
    log += `--- 执行输出 ---\n${result.output || '(无输出)'}\n--- 输出结束 ---\n`;
    
    if (result.success || result.output?.includes('Cert success') || result.output?.includes('Renew success')) {
      const newCheckResult = await sshService.exec(checkCmd);
      
      let expiresAt = null;
      const afterMatch = newCheckResult.output?.match(/notAfter=(.+)/);
      if (afterMatch) {
        expiresAt = parseOpenSSLDate(afterMatch[1].trim());
      }
      
      log += `[${formatTime()}] 证书续期成功!\n`;
      log += `[${formatTime()}] 新过期时间: ${expiresAt || '未知'}\n`;
      
      await db.run('UPDATE domains SET ssl_status = ?, ssl_expires = ?, ssl_log = ? WHERE id = ?', 
        ['active', expiresAt, log, req.params.domain_id]);
      
      res.json({ success: true, message: '证书续期成功', expires: expiresAt, log });
    } else {
      log += `[${formatTime()}] 证书续期失败\n`;
      
      await db.run('UPDATE domains SET ssl_status = ?, ssl_log = ? WHERE id = ?', ['error', log, req.params.domain_id]);
      res.json({ success: false, message: '证书续期失败', output: result.output, log });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 安装acme.sh
router.post('/install-acme', async (req, res) => {
  try {
    const { server_id, email } = req.body;
    
    let server;
    if (server_id) {
      server = await db.get('SELECT * FROM servers WHERE id = ?', [server_id]);
    } else {
      server = await db.get('SELECT * FROM servers LIMIT 1');
    }
    
    if (!server) {
      return res.status(404).json({ error: '没有可用的服务器' });
    }
    
    const sshService = new SshFtpService({
      ip: server.ip,
      port: server.port,
      username: server.username,
      password: server.password
    });
    
    const installCmd = sslCert.getInstallAcmeCommand(email || 'admin@example.com');
    const result = await sshService.exec(installCmd);
    
    res.json({ 
      success: result.success, 
      message: result.success ? 'acme.sh安装成功' : '安装失败',
      output: result.output
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取证书路径
router.get('/paths/:domain', async (req, res) => {
  res.json(sslCert.getCertPath(req.params.domain));
});

// 查看证书内容
router.get('/view/:domain_id', async (req, res) => {
  try {
    const domain = await db.get('SELECT * FROM domains WHERE id = ?', [req.params.domain_id]);
    if (!domain) {
      return res.status(404).json({ error: '域名不存在' });
    }
    
    // 获取服务器
    let server = await db.get(`
      SELECT sv.* FROM subdomains s
      LEFT JOIN servers sv ON s.server_id = sv.id
      WHERE s.domain_id = ? AND sv.id IS NOT NULL
      LIMIT 1
    `, [req.params.domain_id]);
    
    if (!server) {
      server = await db.get('SELECT * FROM servers LIMIT 1');
    }
    
    if (!server) {
      return res.status(400).json({ error: '没有可用的服务器' });
    }
    
    const sshService = new SshFtpService({
      ip: server.ip,
      port: server.port,
      username: server.username,
      password: server.password
    });
    
    const paths = sslCert.getCertPath(domain.domain);
    
    // 读取证书和私钥内容
    const certResult = await sshService.exec(`cat "${paths.fullchain}" 2>/dev/null || echo ""`);
    const keyResult = await sshService.exec(`cat "${paths.key}" 2>/dev/null || echo ""`);
    
    res.json({
      cert: certResult.output?.trim() || '',
      key: keyResult.output?.trim() || ''
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 下载证书（ZIP压缩包）
router.get('/download/:domain_id', async (req, res) => {
  try {
    const domain = await db.get('SELECT * FROM domains WHERE id = ?', [req.params.domain_id]);
    if (!domain) {
      return res.status(404).json({ error: '域名不存在' });
    }
    
    // 获取服务器
    let server = await db.get(`
      SELECT sv.* FROM subdomains s
      LEFT JOIN servers sv ON s.server_id = sv.id
      WHERE s.domain_id = ? AND sv.id IS NOT NULL
      LIMIT 1
    `, [req.params.domain_id]);
    
    if (!server) {
      server = await db.get('SELECT * FROM servers LIMIT 1');
    }
    
    if (!server) {
      return res.status(400).json({ error: '没有可用的服务器' });
    }
    
    const sshService = new SshFtpService({
      ip: server.ip,
      port: server.port,
      username: server.username,
      password: server.password
    });
    
    const paths = sslCert.getCertPath(domain.domain);
    
    // 读取证书和私钥内容
    const certResult = await sshService.exec(`cat "${paths.fullchain}" 2>/dev/null || echo ""`);
    const keyResult = await sshService.exec(`cat "${paths.key}" 2>/dev/null || echo ""`);
    
    const certContent = certResult.output?.trim() || '';
    const keyContent = keyResult.output?.trim() || '';
    
    if (!certContent && !keyContent) {
      return res.status(404).json({ error: '证书文件不存在' });
    }
    
    // 创建ZIP文件
    const archiver = require('archiver');
    const archive = archiver('zip', { zlib: { level: 9 } });
    
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${domain.domain}_ssl.zip"`);
    
    archive.pipe(res);
    
    if (certContent) {
      archive.append(certContent, { name: `${domain.domain}.fullchain.crt` });
    }
    if (keyContent) {
      archive.append(keyContent, { name: `${domain.domain}.key` });
    }
    
    await archive.finalize();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 检查所有域名的证书状态（手动刷新）
router.post('/check-all', async (req, res) => {
  try {
    const domains = await db.all('SELECT * FROM domains WHERE ssl_status = ?', ['active']);
    const results = [];
    
    for (const domain of domains) {
      try {
        // 获取服务器
        let server = await db.get(`
          SELECT sv.* FROM subdomains s
          LEFT JOIN servers sv ON s.server_id = sv.id
          WHERE s.domain_id = ? AND sv.id IS NOT NULL
          LIMIT 1
        `, [domain.id]);
        
        if (!server) {
          server = await db.get('SELECT * FROM servers LIMIT 1');
        }
        
        if (!server) {
          results.push({ domain: domain.domain, status: 'skipped', reason: '无可用服务器' });
          continue;
        }
        
        const sshService = new SshFtpService({
          ip: server.ip,
          port: server.port,
          username: server.username,
          password: server.password
        });
        
        const checkCmd = sslCert.getCheckCommand(domain.domain);
        const result = await sshService.exec(checkCmd);
        
        if (result.output?.includes('CERT_EXISTS=true')) {
          const afterMatch = result.output.match(/notAfter=(.+)/);
          if (afterMatch) {
            const expiresAt = parseOpenSSLDate(afterMatch[1].trim());
            await db.run('UPDATE domains SET ssl_expires = ? WHERE id = ?', [expiresAt, domain.id]);
            results.push({ domain: domain.domain, status: 'updated', expires: expiresAt });
          }
        } else {
          results.push({ domain: domain.domain, status: 'no_cert' });
        }
      } catch (err) {
        results.push({ domain: domain.domain, status: 'error', error: err.message });
      }
    }
    
    res.json({ success: true, checked: domains.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
