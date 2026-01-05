const express = require('express');
const db = require('../db/database');
const { authMiddleware } = require('../middleware/auth');
const SshFtpService = require('../services/ssh-ftp');
const nginxConfig = require('../services/nginx-config');

const router = express.Router();

router.use(authMiddleware);

// 获取Nginx配置模板
router.get('/templates', (req, res) => {
  res.json({
    http: nginxConfig.generateConfig('http', 'example.com'),
    https: nginxConfig.generateConfig('https', 'example.com'),
    proxy: nginxConfig.generateConfig('proxy', 'example.com', { proxyPass: 'http://127.0.0.1:3000' })
  });
});

// 生成Nginx配置预览
router.post('/preview', async (req, res) => {
  try {
    const { subdomain_id, type, custom_config, root_path, proxy_pass } = req.body;
    
    const sub = await db.get(`
      SELECT s.subdomain, d.domain as main_domain,
             CASE WHEN s.subdomain = '@' THEN d.domain ELSE s.subdomain || '.' || d.domain END as full_domain
      FROM subdomains s
      LEFT JOIN domains d ON s.domain_id = d.id
      WHERE s.id = ?
    `, [subdomain_id]);
    
    if (!sub) {
      return res.status(404).json({ error: 'Subdomain not found' });
    }
    
    let config;
    if (custom_config) {
      config = custom_config;
    } else {
      config = nginxConfig.generateConfig(type || 'http', sub.full_domain, {
        rootPath: root_path || `/www/wwwroot/ftp/${sub.full_domain}`,
        proxyPass: proxy_pass
      });
    }
    
    res.json({ config, domain: sub.full_domain });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 保存Nginx配置到数据库
router.post('/save', async (req, res) => {
  try {
    const { subdomain_id, config } = req.body;
    
    await db.run('UPDATE subdomains SET nginx_config = ?, nginx_synced = 0 WHERE id = ?', [config, subdomain_id]);
    
    res.json({ message: 'Config saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 同步Nginx配置到服务器
router.post('/sync/:subdomain_id', async (req, res) => {
  try {
    const sub = await db.get(`
      SELECT s.*, d.domain as main_domain,
             CASE WHEN s.subdomain = '@' THEN d.domain ELSE s.subdomain || '.' || d.domain END as full_domain,
             sv.ip, sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass
      FROM subdomains s
      LEFT JOIN domains d ON s.domain_id = d.id
      LEFT JOIN servers sv ON s.server_id = sv.id
      WHERE s.id = ?
    `, [req.params.subdomain_id]);
    
    if (!sub) {
      return res.status(404).json({ error: 'Subdomain not found' });
    }
    
    if (!sub.ip) {
      return res.status(400).json({ error: '该域名未关联服务器' });
    }
    
    if (!sub.nginx_config) {
      return res.status(400).json({ error: '请先保存Nginx配置' });
    }
    
    const sshService = new SshFtpService({
      ip: sub.ip,
      port: sub.ssh_port,
      username: sub.ssh_user,
      password: sub.ssh_pass
    });
    
    const configPath = nginxConfig.getConfigPath(sub.full_domain);
    const rootPath = `/www/wwwroot/ftp/${sub.full_domain}`;
    
    // 创建网站目录
    await sshService.exec(`sudo mkdir -p ${rootPath}`);
    await sshService.exec(`sudo chown -R www:www ${rootPath} 2>/dev/null || sudo chown -R www-data:www-data ${rootPath}`);
    await sshService.exec(`sudo chmod 755 ${rootPath}`);
    
    // 创建默认 index.html (如果不存在)
    await sshService.exec(`[ ! -f ${rootPath}/index.html ] && sudo bash -c 'cat > ${rootPath}/index.html << EOF
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Welcome</title>
    <style>
        body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
        .container { text-align: center; padding: 50px; background: #fff; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); }
        h1 { color: #333; margin-bottom: 10px; }
        p { color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Welcome!</h1>
        <p>网站建设中...</p>
    </div>
</body>
</html>
EOF'`);
    await sshService.exec(`sudo chown www:www ${rootPath}/index.html 2>/dev/null || sudo chown www-data:www-data ${rootPath}/index.html`);
    
    // 写入Nginx配置文件
    const escapedConfig = sub.nginx_config.replace(/'/g, "'\\''");
    const writeResult = await sshService.exec(`echo '${escapedConfig}' | sudo tee ${configPath}`);
    
    if (!writeResult.success) {
      return res.json({ success: false, message: '写入配置失败: ' + writeResult.output });
    }
    
    // 测试Nginx配置
    const testResult = await sshService.exec('sudo nginx -t 2>&1');
    
    if (!testResult.success && !testResult.output.includes('successful')) {
      return res.json({ success: false, message: 'Nginx配置测试失败: ' + testResult.output });
    }
    
    // 重载Nginx
    const reloadResult = await sshService.exec('sudo nginx -s reload 2>&1 || sudo systemctl reload nginx');
    
    await db.run('UPDATE subdomains SET nginx_synced = 1 WHERE id = ?', [req.params.subdomain_id]);
    
    res.json({ success: true, message: 'Nginx配置已同步并重载' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 从服务器获取当前Nginx配置
router.get('/fetch/:subdomain_id', async (req, res) => {
  try {
    const sub = await db.get(`
      SELECT s.*, d.domain as main_domain,
             CASE WHEN s.subdomain = '@' THEN d.domain ELSE s.subdomain || '.' || d.domain END as full_domain,
             sv.ip, sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass
      FROM subdomains s
      LEFT JOIN domains d ON s.domain_id = d.id
      LEFT JOIN servers sv ON s.server_id = sv.id
      WHERE s.id = ?
    `, [req.params.subdomain_id]);
    
    if (!sub || !sub.ip) {
      return res.status(400).json({ error: '域名未关联服务器' });
    }
    
    const sshService = new SshFtpService({
      ip: sub.ip,
      port: sub.ssh_port,
      username: sub.ssh_user,
      password: sub.ssh_pass
    });
    
    const configPath = nginxConfig.getConfigPath(sub.full_domain);
    const result = await sshService.exec(`cat ${configPath} 2>/dev/null`);
    
    if (result.success && result.output) {
      res.json({ config: result.output, exists: true });
    } else {
      res.json({ config: '', exists: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除服务器上的Nginx配置
router.delete('/remove/:subdomain_id', async (req, res) => {
  try {
    const sub = await db.get(`
      SELECT s.*, d.domain as main_domain,
             CASE WHEN s.subdomain = '@' THEN d.domain ELSE s.subdomain || '.' || d.domain END as full_domain,
             sv.ip, sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass
      FROM subdomains s
      LEFT JOIN domains d ON s.domain_id = d.id
      LEFT JOIN servers sv ON s.server_id = sv.id
      WHERE s.id = ?
    `, [req.params.subdomain_id]);
    
    if (!sub || !sub.ip) {
      return res.json({ success: true, message: '无需删除' });
    }
    
    const sshService = new SshFtpService({
      ip: sub.ip,
      port: sub.ssh_port,
      username: sub.ssh_user,
      password: sub.ssh_pass
    });
    
    const configPath = nginxConfig.getConfigPath(sub.full_domain);
    await sshService.exec(`sudo rm -f ${configPath}`);
    await sshService.exec('sudo nginx -s reload 2>&1 || sudo systemctl reload nginx');
    
    await db.run('UPDATE subdomains SET nginx_config = NULL, nginx_synced = 0 WHERE id = ?', [req.params.subdomain_id]);
    
    res.json({ success: true, message: 'Nginx配置已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
