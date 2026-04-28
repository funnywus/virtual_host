const express = require('express');
const net = require('net');
const db = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

// 获取服务器列表
router.get('/', async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? null : req.user.id;
    const sql = userId 
      ? 'SELECT * FROM servers WHERE user_id = ?' 
      : 'SELECT * FROM servers';
    const servers = await db.all(sql, userId ? [userId] : []);
    res.json(servers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 测试服务器连接
router.post('/:id/test', async (req, res) => {
  try {
    const server = await db.get('SELECT * FROM servers WHERE id = ?', [req.params.id]);
    if (!server) {
      return res.status(404).json({ error: 'Server not found' });
    }

    const result = await testConnection(server.ip, server.port);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 测试IP端口连通性
function testConnection(ip, port, timeout = 5000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const startTime = Date.now();

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      const latency = Date.now() - startTime;
      socket.destroy();
      resolve({ success: true, message: `连接成功，延迟 ${latency}ms`, latency });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ success: false, message: '连接超时' });
    });

    socket.on('error', (err) => {
      socket.destroy();
      resolve({ success: false, message: `连接失败: ${err.message}` });
    });

    socket.connect(port, ip);
  });
}

// 获取服务器关联的域名
router.get('/:id/domains', async (req, res) => {
  try {
    const domains = await db.all(`
      SELECT s.subdomain, d.domain as main_domain, s.record_type, s.record_value, s.status,
             CASE WHEN s.subdomain = '@' THEN d.domain ELSE ${db.concat('s.subdomain', `'.'`, 'd.domain')} END as full_domain
      FROM subdomains s
      LEFT JOIN domains d ON s.domain_id = d.id
      WHERE s.server_id = ?
    `, [req.params.id]);
    res.json(domains);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 添加服务器
router.post('/', async (req, res) => {
  try {
    const { name, ip, port, username, password, tags, expire_at, status } = req.body;
    const serverStatus = status === 'disabled' ? 'disabled' : 'active';
    const result = await db.run(
      'INSERT INTO servers (name, ip, port, username, password, tags, user_id, expire_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, ip, port || 22, username, password, tags || '', req.user.id, expire_at || null, serverStatus]
    );
    res.json({ id: result.lastID, message: 'Server added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 更新服务器
router.put('/:id', async (req, res) => {
  try {
    const { name, ip, port, username, password, tags, nginx_path, ftp_path, expire_at, status } = req.body;
    const server = await db.get('SELECT * FROM servers WHERE id = ?', [req.params.id]);
    if (!server) {
      return res.status(404).json({ error: '服务器不存在' });
    }
    
    // 如果密码为空，保留原密码
    const newPassword = password || server.password;
    const serverStatus = status === 'disabled' ? 'disabled' : 'active';
    
    await db.run(
      'UPDATE servers SET name = ?, ip = ?, port = ?, username = ?, password = ?, tags = ?, nginx_path = ?, ftp_path = ?, expire_at = ?, status = ? WHERE id = ?',
      [name, ip, port || 22, username, newPassword, tags || '', nginx_path || '/www/server/panel/vhost/nginx', ftp_path || '/www/wwwroot/ftp', expire_at || null, serverStatus, req.params.id]
    );
    res.json({ message: '更新成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除服务器
router.delete('/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM servers WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ message: 'Server deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 设置默认服务器
router.post('/:id/set-default', async (req, res) => {
  try {
    // 先清除所有默认
    await db.run('UPDATE servers SET is_default = 0 WHERE user_id = ?', [req.user.id]);
    // 设置当前为默认
    await db.run('UPDATE servers SET is_default = 1 WHERE id = ?', [req.params.id]);
    res.json({ message: '已设为默认' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== 文件管理 ==========
const SshFtpService = require('../services/ssh-ftp');
const path = require('path');

// 获取SSH服务实例
async function getSshService(serverId) {
  const server = await db.get('SELECT * FROM servers WHERE id = ?', [serverId]);
  if (!server) throw new Error('服务器不存在');
  return new SshFtpService({
    ip: server.ip,
    port: server.port,
    username: server.username,
    password: server.password
  });
}

// 获取文件列表
router.post('/:id/files', async (req, res) => {
  try {
    const { path: dirPath = '/' } = req.body;
    const sshService = await getSshService(req.params.id);
    const result = await sshService.exec(`ls -la "${dirPath}" 2>/dev/null | tail -n +2`);
    
    const files = (result.output || '').split('\n').filter(line => line.trim()).map(line => {
      const parts = line.split(/\s+/);
      if (parts.length < 9) return null;
      const permissions = parts[0];
      const size = parseInt(parts[4]) || 0;
      const date = `${parts[5]} ${parts[6]} ${parts[7]}`;
      const name = parts.slice(8).join(' ');
      if (name === '.' || name === '..') return null;
      return { name, type: permissions.startsWith('d') ? 'directory' : 'file', size, date, permissions };
    }).filter(f => f);
    
    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 创建文件夹
router.post('/:id/files/mkdir', async (req, res) => {
  try {
    const { path: dirPath, name } = req.body;
    const sshService = await getSshService(req.params.id);
    const targetPath = path.join(dirPath, name);
    await sshService.exec(`mkdir -p "${targetPath}"`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 上传文件
router.post('/:id/files/upload', async (req, res) => {
  try {
    const { path: dirPath, filename, content } = req.body;
    const sshService = await getSshService(req.params.id);
    const targetPath = path.join(dirPath, filename);
    const fileBuffer = Buffer.from(content, 'base64');
    await sshService.uploadFile(fileBuffer, targetPath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 读取文件内容
router.post('/:id/files/read', async (req, res) => {
  try {
    const { path: filePath } = req.body;
    const sshService = await getSshService(req.params.id);
    const result = await sshService.exec(`cat "${filePath}" 2>/dev/null`);
    res.json({ content: result.output || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 读取二进制文件
router.post('/:id/files/read-binary', async (req, res) => {
  try {
    const { path: filePath } = req.body;
    const sshService = await getSshService(req.params.id);
    const result = await sshService.exec(`base64 "${filePath}" 2>/dev/null | tr -d '\\n'`);
    res.json({ content: result.output || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 写入文件
router.post('/:id/files/write', async (req, res) => {
  try {
    const { path: filePath, content } = req.body;
    const sshService = await getSshService(req.params.id);
    const base64Content = Buffer.from(content, 'utf-8').toString('base64');
    await sshService.exec(`echo "${base64Content}" | base64 -d > "${filePath}"`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除文件/文件夹
router.post('/:id/files/delete', async (req, res) => {
  try {
    const { path: filePath } = req.body;
    const sshService = await getSshService(req.params.id);
    await sshService.exec(`rm -rf "${filePath}"`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 重命名文件/文件夹
router.post('/:id/files/rename', async (req, res) => {
  try {
    const { oldPath, newPath } = req.body;
    const sshService = await getSshService(req.params.id);
    await sshService.exec(`mv "${oldPath}" "${newPath}"`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== 终端 ==========
// 执行命令
router.post('/:id/exec', async (req, res) => {
  try {
    const { command } = req.body;
    if (!command) {
      return res.status(400).json({ error: '命令不能为空' });
    }
    
    const sshService = await getSshService(req.params.id);
    const result = await sshService.exec(command);
    
    res.json({ 
      output: result.output || '', 
      error: result.error || '' 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 检查软件安装状态
router.get('/:id/software-status', async (req, res) => {
  try {
    const sshService = await getSshService(req.params.id);
    
    // 检查 nginx 及配置路径
    const nginxResult = await sshService.exec('which nginx 2>/dev/null && nginx -v 2>&1 | head -1');
    const nginxInstalled = nginxResult.output?.includes('nginx');
    let nginxConfigPath = '/etc/nginx/nginx.conf';
    if (nginxInstalled) {
      const configResult = await sshService.exec('nginx -t 2>&1 | grep -oP "(?<=configuration file )\\S+" | head -1');
      if (configResult.output?.trim()) {
        nginxConfigPath = configResult.output.trim();
      }
    }
    
    // 检查 vsftpd 及配置路径
    const ftpResult = await sshService.exec('which vsftpd 2>/dev/null && vsftpd -v 2>&1 | head -1');
    const ftpInstalled = ftpResult.output?.includes('vsftpd');
    let ftpConfigPath = '/etc/vsftpd.conf';
    if (ftpInstalled) {
      // 尝试多个常见路径
      const configCheck = await sshService.exec('ls /etc/vsftpd.conf /etc/vsftpd/vsftpd.conf 2>/dev/null | head -1');
      if (configCheck.output?.trim()) {
        ftpConfigPath = configCheck.output.trim();
      }
    }
    
    // 检查 pure-ftpd
    const pureFtpResult = await sshService.exec('which pure-ftpd 2>/dev/null');
    const pureFtpInstalled = pureFtpResult.output?.includes('pure-ftpd');
    
    res.json({
      nginx: { 
        installed: nginxInstalled, 
        version: nginxInstalled ? nginxResult.output.trim() : '',
        configPath: nginxConfigPath
      },
      vsftpd: { 
        installed: ftpInstalled, 
        version: ftpInstalled ? ftpResult.output.trim() : '',
        configPath: ftpConfigPath
      },
      pureFtpd: { installed: pureFtpInstalled }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 安装 Nginx
router.post('/:id/install-nginx', async (req, res) => {
  try {
    const sshService = await getSshService(req.params.id);
    
    // 检测系统类型
    const osResult = await sshService.exec('cat /etc/os-release 2>/dev/null | grep -i "^ID=" | cut -d= -f2 | tr -d \'"\'');
    const os = osResult.output?.trim().toLowerCase();
    
    let installCmd = '';
    if (os === 'ubuntu' || os === 'debian') {
      installCmd = 'apt-get update && apt-get install -y nginx';
    } else if (os === 'centos' || os === 'rhel' || os === 'fedora' || os === 'rocky' || os === 'almalinux') {
      installCmd = 'yum install -y nginx || dnf install -y nginx';
    } else {
      return res.status(400).json({ error: `不支持的系统: ${os}` });
    }
    
    const result = await sshService.exec(installCmd);
    
    // 启动并设置开机自启
    await sshService.exec('systemctl start nginx && systemctl enable nginx');
    
    res.json({ success: true, message: 'Nginx 安装成功', output: result.output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 安装 FTP (vsftpd)
router.post('/:id/install-ftp', async (req, res) => {
  try {
    const sshService = await getSshService(req.params.id);
    
    // 检测系统类型
    const osResult = await sshService.exec('cat /etc/os-release 2>/dev/null | grep -i "^ID=" | cut -d= -f2 | tr -d \'"\'');
    const os = osResult.output?.trim().toLowerCase();
    
    let installCmd = '';
    if (os === 'ubuntu' || os === 'debian') {
      installCmd = 'apt-get update && apt-get install -y vsftpd';
    } else if (os === 'centos' || os === 'rhel' || os === 'fedora' || os === 'rocky' || os === 'almalinux') {
      installCmd = 'yum install -y vsftpd || dnf install -y vsftpd';
    } else {
      return res.status(400).json({ error: `不支持的系统: ${os}` });
    }
    
    const result = await sshService.exec(installCmd);
    
    // 启动并设置开机自启
    await sshService.exec('systemctl start vsftpd && systemctl enable vsftpd');
    
    res.json({ success: true, message: 'FTP (vsftpd) 安装成功', output: result.output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 重启 Nginx
router.post('/:id/restart-nginx', async (req, res) => {
  try {
    const sshService = await getSshService(req.params.id);
    const result = await sshService.exec('nginx -t && systemctl reload nginx');
    res.json({ success: result.success, message: result.success ? 'Nginx 重启成功' : result.output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 重启 FTP
router.post('/:id/restart-ftp', async (req, res) => {
  try {
    const sshService = await getSshService(req.params.id);
    const result = await sshService.exec('systemctl restart vsftpd');
    res.json({ success: result.success, message: result.success ? 'FTP 重启成功' : result.output });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
