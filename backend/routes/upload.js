
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db/database');
const SshFtpService = require('../services/ssh-ftp');

const router = express.Router();

// 配置 multer 用于处理文件上传（存储在内存中）
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 } // 1GB 限制
});

// 计算域名的授权码 (MD5完整32位小写)
function getDomainAuthCode(domain) {
  return crypto.createHash('md5').update(domain).digest('hex').toLowerCase();
}

// 通过授权码验证 (授权码 = 域名的MD5前8位)
router.post('/auth', async (req, res) => {
  try {
    const { auth_code } = req.body;
    
    if (!auth_code) {
      return res.status(400).json({ error: '请输入授权码' });
    }
    
    // 查找所有FTP账号
    const ftpAccounts = await db.all(`
      SELECT f.*, s.id as subdomain_id, s.subdomain, s.expire_at, s.use_status, s.activated_at, s.duration_days,
             d.domain as main_domain,
             CASE WHEN s.subdomain = '@' THEN d.domain ELSE ${db.concat('s.subdomain', `'.'`, 'd.domain')} END as full_domain,
             sv.ip, sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass
      FROM ftp_accounts f
      LEFT JOIN subdomains s ON f.subdomain_id = s.id
      LEFT JOIN domains d ON s.domain_id = d.id
      LEFT JOIN servers sv ON s.server_id = sv.id
      WHERE f.status = 'active' AND (s.use_status IS NULL OR s.use_status != 'disabled')
    `);
    
    // 查找匹配的FTP账号 (授权码 = 域名MD5)
    const inputCode = auth_code.toLowerCase();
    const ftp = ftpAccounts.find(f => getDomainAuthCode(f.full_domain) === inputCode);
    
    if (!ftp) {
      return res.status(401).json({ error: '授权码无效或已禁用' });
    }

    // 检查是否已停用
    if (ftp.use_status === 'disabled') {
      return res.status(401).json({ error: '该域名已停用，请联系客服续费' });
    }

    // 首次登录激活：设置激活时间和到期时间（从第二天开始算）
    let expireAt = ftp.expire_at;
    let activatedAt = ftp.activated_at;
    
    if (!activatedAt && ftp.duration_days) {
      // 首次激活
      const now = new Date();
      activatedAt = now.toISOString().slice(0, 19).replace('T', ' ');
      
      // 到期时间 = 明天 + duration_days 天
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);
      
      const expireDate = new Date(tomorrow);
      expireDate.setDate(expireDate.getDate() + ftp.duration_days);
      expireAt = expireDate.toISOString().slice(0, 19).replace('T', ' ');
      
      // 更新数据库
      await db.run(
        'UPDATE subdomains SET activated_at = ?, expire_at = ?, use_status = ? WHERE id = ?',
        [activatedAt, expireAt, 'used', ftp.subdomain_id]
      );
    }

    // 计算剩余天数
    let remainingDays = null;
    if (expireAt) {
      const now = new Date();
      const expire = new Date(expireAt);
      remainingDays = Math.ceil((expire - now) / (1000 * 60 * 60 * 24));
      if (remainingDays < 0) remainingDays = 0;
    }
    
    res.json({
      success: true,
      domain: ftp.full_domain,
      home_dir: ftp.home_dir,
      ftp_id: ftp.id,
      max_upload_size: ftp.max_upload_size || 524288000,
      expire_at: expireAt || null,
      activated_at: activatedAt || null,
      remaining_days: remainingDays,
      use_status: ftp.use_status || 'unused',
      // 添加 FTP 连接信息（用于 WebSocket 直传）
      server_ip: ftp.ip,
      server_port: ftp.ssh_port || 22,
      ftp_username: ftp.ssh_user,
      ftp_password: ftp.ssh_pass
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 通用函数：根据授权码查找FTP账号
async function findFtpByAuthCode(auth_code) {
  const ftpAccounts = await db.all(`
    SELECT f.*, s.subdomain, d.domain as main_domain,
           CASE WHEN s.subdomain = '@' THEN d.domain ELSE ${db.concat('s.subdomain', `'.'`, 'd.domain')} END as full_domain,
           sv.ip, sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass
    FROM ftp_accounts f
    LEFT JOIN subdomains s ON f.subdomain_id = s.id
    LEFT JOIN domains d ON s.domain_id = d.id
    LEFT JOIN servers sv ON s.server_id = sv.id
    WHERE f.status = 'active' AND (s.use_status IS NULL OR s.use_status != 'disabled')
  `);
  
  const inputCode = auth_code.toLowerCase();
  return ftpAccounts.find(f => getDomainAuthCode(f.full_domain) === inputCode);
}

// 获取空间使用情况
router.post('/usage', async (req, res) => {
  try {
    const { auth_code } = req.body;
    
    const ftp = await findFtpByAuthCode(auth_code);
    
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }
    
    const sshService = new SshFtpService({
      ip: ftp.ip,
      port: ftp.ssh_port,
      username: ftp.ssh_user,
      password: ftp.ssh_pass
    });
    
    const result = await sshService.exec(`du -sb "${ftp.home_dir}" 2>/dev/null | cut -f1`);
    const usedSize = parseInt(result.output?.trim()) || 0;
    
    res.json({
      used_size: usedSize,
      max_size: ftp.max_upload_size || 524288000,
      remaining: Math.max(0, (ftp.max_upload_size || 524288000) - usedSize)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取文件列表
router.post('/list', async (req, res) => {
  try {
    const { auth_code, path: dirPath } = req.body;
    
    const ftp = await findFtpByAuthCode(auth_code);
    
    if (!ftp) {
      return res.status(401).json({ error: '授权码无效' });
    }
    
    if (!ftp.ip) {
      return res.status(400).json({ error: '服务器未配置' });
    }
    
    const sshService = new SshFtpService({
      ip: ftp.ip,
      port: ftp.ssh_port,
      username: ftp.ssh_user,
      password: ftp.ssh_pass
    });
    
    // 确保路径在home_dir内
    const targetPath = dirPath ? path.join(ftp.home_dir, dirPath) : ftp.home_dir;
    if (!targetPath.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权访问该目录' });
    }
    
    const result = await sshService.exec(`ls -la "${targetPath}" 2>/dev/null | tail -n +2`);
    
    if (!result.success) {
      return res.json({ files: [], current_path: dirPath || '/' });
    }
    
    const files = result.output.split('\n').filter(line => line.trim()).map(line => {
      const parts = line.split(/\s+/);
      if (parts.length < 9) return null;
      
      const permissions = parts[0];
      const size = parseInt(parts[4]) || 0;
      const date = `${parts[5]} ${parts[6]} ${parts[7]}`;
      const name = parts.slice(8).join(' ');
      
      if (name === '.' || name === '..') return null;
      
      return {
        name,
        type: permissions.startsWith('d') ? 'directory' : 'file',
        size,
        date,
        permissions
      };
    }).filter(f => f);
    
    res.json({ files, current_path: dirPath || '/' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 上传文件
router.post('/upload', async (req, res) => {
  try {
    const { auth_code, path: dirPath, filename, content, filesize } = req.body;
    
    const ftp = await findFtpByAuthCode(auth_code);
    
    if (!ftp) {
      return res.status(401).json({ error: '授权码无效' });
    }
    
    if (!ftp.ip) {
      return res.status(400).json({ error: '服务器未配置' });
    }

    const sshService = new SshFtpService({
      ip: ftp.ip,
      port: ftp.ssh_port,
      username: ftp.ssh_user,
      password: ftp.ssh_pass
    });

    // 检查空间大小限制
    const maxSize = ftp.max_upload_size || 524288000; // 默认500MB
    const fileBuffer = Buffer.from(content, 'base64');
    const actualFileSize = filesize || fileBuffer.length;
    
    // 获取当前目录总大小
    const sizeResult = await sshService.exec(`du -sb "${ftp.home_dir}" 2>/dev/null | cut -f1`);
    const currentSize = parseInt(sizeResult.output?.trim()) || 0;
    
    if (currentSize + actualFileSize > maxSize) {
      return res.status(400).json({ 
        error: `空间不足，已用 ${formatSize(currentSize)}，限制 ${formatSize(maxSize)}`,
        current_size: currentSize,
        max_size: maxSize
      });
    }
    
    // 确保路径在home_dir内
    const targetDir = dirPath ? path.join(ftp.home_dir, dirPath) : ftp.home_dir;
    if (!targetDir.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权访问该目录' });
    }
    
    const targetFile = path.join(targetDir, filename);
    
    // 先创建目录（如果不存在）
    await sshService.exec(`mkdir -p "${targetDir}"`);
    
    // 使用SFTP上传文件（支持大文件）
    try {
      await sshService.uploadFile(fileBuffer, targetFile);
    } catch (uploadErr) {
      return res.status(500).json({ error: '上传失败: ' + uploadErr.message });
    }
    
    // 设置权限 755 和所有者 www
    await sshService.exec(`chmod 755 "${targetFile}"`);
    await sshService.exec(`chown www:www "${targetFile}" 2>/dev/null || chown www "${targetFile}" 2>/dev/null`);
    // 同时设置目录权限
    await sshService.exec(`chmod 755 "${targetDir}"`);
    await sshService.exec(`chown www:www "${targetDir}" 2>/dev/null || chown www "${targetDir}" 2>/dev/null`);
    
    res.json({ success: true, message: '上传成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 格式化文件大小
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
}

// 上传文件（FormData 方式，支持大文件和进度）
router.post('/upload-file', upload.single('file'), async (req, res) => {
  try {
    const { auth_code, path: dirPath, filename } = req.body;
    const file = req.file;
    
    if (!file) {
      return res.status(400).json({ error: '未选择文件' });
    }
    
    const ftp = await findFtpByAuthCode(auth_code);
    
    if (!ftp) {
      return res.status(401).json({ error: '授权码无效' });
    }
    
    if (!ftp.ip) {
      return res.status(400).json({ error: '服务器未配置' });
    }

    const sshService = new SshFtpService({
      ip: ftp.ip,
      port: ftp.ssh_port,
      username: ftp.ssh_user,
      password: ftp.ssh_pass
    });

    // 检查空间大小限制
    const maxSize = ftp.max_upload_size || 524288000; // 默认500MB
    const actualFileSize = file.size;
    
    // 获取当前目录总大小
    const sizeResult = await sshService.exec(`du -sb "${ftp.home_dir}" 2>/dev/null | cut -f1`);
    const currentSize = parseInt(sizeResult.output?.trim()) || 0;
    
    if (currentSize + actualFileSize > maxSize) {
      return res.status(400).json({ 
        error: `空间不足，已用 ${formatSize(currentSize)}，限制 ${formatSize(maxSize)}`,
        current_size: currentSize,
        max_size: maxSize
      });
    }
    
    // 确保路径在home_dir内
    const targetDir = dirPath ? path.join(ftp.home_dir, dirPath) : ftp.home_dir;
    if (!targetDir.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权访问该目录' });
    }
    
    const targetFile = path.join(targetDir, filename);
    
    // 先创建目录（如果不存在）
    await sshService.exec(`mkdir -p "${targetDir}"`);
    
    // 使用SFTP上传文件（支持大文件）
    try {
      await sshService.uploadFile(file.buffer, targetFile);
    } catch (uploadErr) {
      return res.status(500).json({ error: '上传失败: ' + uploadErr.message });
    }
    
    // 设置权限 644 和所有者 www
    await sshService.exec(`chmod 644 "${targetFile}"`);
    await sshService.exec(`chown www:www "${targetFile}" 2>/dev/null || chown www "${targetFile}" 2>/dev/null`);
    // 同时设置目录权限
    await sshService.exec(`chmod 755 "${targetDir}"`);
    await sshService.exec(`chown www:www "${targetDir}" 2>/dev/null || chown www "${targetDir}" 2>/dev/null`);
    
    res.json({ success: true, message: '上传成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 创建目录
router.post('/mkdir', async (req, res) => {
  try {
    const { auth_code, path: dirPath, name } = req.body;
    
    const ftp = await findFtpByAuthCode(auth_code);
    
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }
    
    const sshService = new SshFtpService({
      ip: ftp.ip,
      port: ftp.ssh_port,
      username: ftp.ssh_user,
      password: ftp.ssh_pass
    });
    
    const targetDir = dirPath ? path.join(ftp.home_dir, dirPath, name) : path.join(ftp.home_dir, name);
    if (!targetDir.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权访问该目录' });
    }
    
    const result = await sshService.exec(`mkdir -p "${targetDir}"`);
    
    // 设置权限 755 和所有者 www
    if (result.success) {
      await sshService.exec(`chmod 755 "${targetDir}"`);
      await sshService.exec(`chown www:www "${targetDir}" 2>/dev/null || chown www "${targetDir}" 2>/dev/null`);
    }
    
    res.json({ success: result.success, message: result.success ? '创建成功' : '创建失败' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 创建文件
router.post('/create-file', async (req, res) => {
  try {
    const { auth_code, path: dirPath, name, content } = req.body;
    
    const ftp = await findFtpByAuthCode(auth_code);
    
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }
    
    const sshService = new SshFtpService({
      ip: ftp.ip,
      port: ftp.ssh_port,
      username: ftp.ssh_user,
      password: ftp.ssh_pass
    });
    
    const targetFile = dirPath ? path.join(ftp.home_dir, dirPath, name) : path.join(ftp.home_dir, name);
    if (!targetFile.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权访问该目录' });
    }
    
    // 使用 cat 写入文件内容，转义特殊字符
    const escapedContent = (content || '').replace(/'/g, "'\\''");
    const result = await sshService.exec(`cat > "${targetFile}" << 'EOFCONTENT'\n${escapedContent}\nEOFCONTENT`);
    
    // 设置权限 644 和所有者 www
    await sshService.exec(`chmod 644 "${targetFile}"`);
    await sshService.exec(`chown www:www "${targetFile}" 2>/dev/null || chown www "${targetFile}" 2>/dev/null`);
    
    res.json({ success: true, message: '创建成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除文件/目录
router.post('/delete', async (req, res) => {
  try {
    const { auth_code, path: filePath } = req.body;
    
    const ftp = await findFtpByAuthCode(auth_code);
    
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }
    
    const sshService = new SshFtpService({
      ip: ftp.ip,
      port: ftp.ssh_port,
      username: ftp.ssh_user,
      password: ftp.ssh_pass
    });
    
    const targetPath = path.join(ftp.home_dir, filePath);
    if (!targetPath.startsWith(ftp.home_dir) || targetPath === ftp.home_dir) {
      return res.status(403).json({ error: '无权删除该文件' });
    }
    
    const result = await sshService.exec(`rm -rf "${targetPath}"`);
    
    res.json({ success: result.success, message: result.success ? '删除成功' : '删除失败' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 读取文件内容（文本）
router.post('/read', async (req, res) => {
  try {
    const { auth_code, path: filePath } = req.body;
    
    const ftp = await findFtpByAuthCode(auth_code);
    
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }
    
    const sshService = new SshFtpService({
      ip: ftp.ip,
      port: ftp.ssh_port,
      username: ftp.ssh_user,
      password: ftp.ssh_pass
    });
    
    const targetPath = path.join(ftp.home_dir, filePath);
    if (!targetPath.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权访问该文件' });
    }
    
    const result = await sshService.exec(`cat "${targetPath}" 2>/dev/null`);
    
    res.json({ content: result.output || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 读取文件内容（二进制，返回base64）
router.post('/read-binary', async (req, res) => {
  try {
    const { auth_code, path: filePath } = req.body;
    
    const ftp = await findFtpByAuthCode(auth_code);
    
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }
    
    const sshService = new SshFtpService({
      ip: ftp.ip,
      port: ftp.ssh_port,
      username: ftp.ssh_user,
      password: ftp.ssh_pass
    });
    
    const targetPath = path.join(ftp.home_dir, filePath);
    if (!targetPath.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权访问该文件' });
    }
    
    const result = await sshService.exec(`base64 "${targetPath}" 2>/dev/null | tr -d '\\n'`);
    
    res.json({ content: result.output || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 写入文件内容
router.post('/write', async (req, res) => {
  try {
    const { auth_code, path: filePath, content } = req.body;
    
    const ftp = await findFtpByAuthCode(auth_code);
    
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }
    
    const sshService = new SshFtpService({
      ip: ftp.ip,
      port: ftp.ssh_port,
      username: ftp.ssh_user,
      password: ftp.ssh_pass
    });
    
    const targetPath = path.join(ftp.home_dir, filePath);
    if (!targetPath.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权访问该文件' });
    }
    
    // 将内容转为base64后写入，避免特殊字符问题
    const base64Content = Buffer.from(content, 'utf-8').toString('base64');
    const result = await sshService.exec(`echo "${base64Content}" | base64 -d > "${targetPath}"`);
    
    if (result.success || result.code === 0) {
      // 设置权限
      await sshService.exec(`chmod 644 "${targetPath}"`);
      res.json({ success: true, message: '保存成功' });
    } else {
      res.status(500).json({ error: '保存失败' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 重命名文件/目录
router.post('/rename', async (req, res) => {
  try {
    const { auth_code, oldPath, newPath } = req.body;
    
    const ftp = await findFtpByAuthCode(auth_code);
    
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }
    
    const sshService = new SshFtpService({
      ip: ftp.ip,
      port: ftp.ssh_port,
      username: ftp.ssh_user,
      password: ftp.ssh_pass
    });
    
    const targetOldPath = path.join(ftp.home_dir, oldPath);
    const targetNewPath = path.join(ftp.home_dir, newPath);
    
    if (!targetOldPath.startsWith(ftp.home_dir) || !targetNewPath.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权操作该文件' });
    }
    
    const result = await sshService.exec(`mv "${targetOldPath}" "${targetNewPath}"`);
    
    res.json({ success: result.success, message: result.success ? '重命名成功' : '重命名失败' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 解压文件
router.post('/extract', async (req, res) => {
  try {
    const { auth_code, path: filePath, target_dir } = req.body;
    
    const ftp = await findFtpByAuthCode(auth_code);
    
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }
    
    const sshService = new SshFtpService({
      ip: ftp.ip,
      port: ftp.ssh_port,
      username: ftp.ssh_user,
      password: ftp.ssh_pass
    });
    
    const targetFile = path.join(ftp.home_dir, filePath);
    if (!targetFile.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权访问该文件' });
    }
    
    // 确定解压目标目录
    const extractDir = target_dir 
      ? path.join(ftp.home_dir, target_dir)
      : path.dirname(targetFile);
    
    if (!extractDir.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权访问该目录' });
    }
    
    // 检查文件类型并解压
    const ext = path.extname(targetFile).toLowerCase();
    let result;
    
    if (ext === '.zip') {
      // 解压 zip 文件
      result = await sshService.exec(`cd "${extractDir}" && unzip -o "${targetFile}"`);
    } else if (ext === '.gz' || ext === '.tgz') {
      // 解压 tar.gz 文件
      result = await sshService.exec(`cd "${extractDir}" && tar -xzf "${targetFile}"`);
    } else if (ext === '.tar') {
      // 解压 tar 文件
      result = await sshService.exec(`cd "${extractDir}" && tar -xf "${targetFile}"`);
    } else if (ext === '.7z') {
      // 解压 7z 文件
      result = await sshService.exec(`cd "${extractDir}" && 7z x "${targetFile}" -y`);
    } else {
      return res.status(400).json({ error: '不支持的压缩格式，仅支持 .zip, .tar.gz, .tar, .7z' });
    }
    
    if (result.success || result.code === 0) {
      // 设置解压后文件的权限
      await sshService.exec(`chmod -R 755 "${extractDir}"`);
      await sshService.exec(`find "${extractDir}" -type f -exec chmod 644 {} \\;`);
      await sshService.exec(`chown -R www:www "${extractDir}" 2>/dev/null || chown -R www "${extractDir}" 2>/dev/null`);
      
      res.json({ success: true, message: '解压成功' });
    } else {
      res.status(500).json({ error: '解压失败: ' + (result.error || '未知错误') });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 压缩文件/目录
router.post('/compress', async (req, res) => {
  try {
    const { auth_code, paths, archive_name, format } = req.body;
    
    const ftp = await findFtpByAuthCode(auth_code);
    
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }
    
    const sshService = new SshFtpService({
      ip: ftp.ip,
      port: ftp.ssh_port,
      username: ftp.ssh_user,
      password: ftp.ssh_pass
    });
    
    // 验证所有路径
    const fullPaths = paths.map(p => path.join(ftp.home_dir, p));
    if (!fullPaths.every(p => p.startsWith(ftp.home_dir))) {
      return res.status(403).json({ error: '无权访问某些文件' });
    }
    
    const archivePath = path.join(ftp.home_dir, archive_name);
    const archiveFormat = format || 'zip';
    
    let result;
    const fileList = paths.map(p => `"${p}"`).join(' ');
    
    if (archiveFormat === 'zip') {
      result = await sshService.exec(`cd "${ftp.home_dir}" && zip -r "${archive_name}" ${fileList}`);
    } else if (archiveFormat === 'tar.gz') {
      result = await sshService.exec(`cd "${ftp.home_dir}" && tar -czf "${archive_name}" ${fileList}`);
    } else {
      return res.status(400).json({ error: '不支持的压缩格式' });
    }
    
    if (result.success || result.code === 0) {
      res.json({ success: true, message: '压缩成功', archive: archive_name });
    } else {
      res.status(500).json({ error: '压缩失败' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 复制文件/目录
router.post('/copy', async (req, res) => {
  try {
    const { auth_code, source_path, target_path } = req.body;
    
    const ftp = await findFtpByAuthCode(auth_code);
    
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }
    
    const sshService = new SshFtpService({
      ip: ftp.ip,
      port: ftp.ssh_port,
      username: ftp.ssh_user,
      password: ftp.ssh_pass
    });
    
    const sourcePath = path.join(ftp.home_dir, source_path);
    const targetPath = path.join(ftp.home_dir, target_path);
    
    if (!sourcePath.startsWith(ftp.home_dir) || !targetPath.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权操作该文件' });
    }
    
    // 使用 cp -r 复制（支持文件和目录）
    const result = await sshService.exec(`cp -r "${sourcePath}" "${targetPath}"`);
    
    if (result.success || result.code === 0) {
      // 设置权限
      await sshService.exec(`chmod -R 755 "${targetPath}"`);
      await sshService.exec(`find "${targetPath}" -type f -exec chmod 644 {} \\;`);
      await sshService.exec(`chown -R www:www "${targetPath}" 2>/dev/null || chown -R www "${targetPath}" 2>/dev/null`);
      
      res.json({ success: true, message: '复制成功' });
    } else {
      res.status(500).json({ error: '复制失败: ' + (result.output || '未知错误') });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 剪切（移动）文件/目录
router.post('/cut', async (req, res) => {
  try {
    const { auth_code, source_path, target_path } = req.body;
    
    const ftp = await findFtpByAuthCode(auth_code);
    
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }
    
    const sshService = new SshFtpService({
      ip: ftp.ip,
      port: ftp.ssh_port,
      username: ftp.ssh_user,
      password: ftp.ssh_pass
    });
    
    const sourcePath = path.join(ftp.home_dir, source_path);
    const targetPath = path.join(ftp.home_dir, target_path);
    
    if (!sourcePath.startsWith(ftp.home_dir) || !targetPath.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权操作该文件' });
    }
    
    // 使用 mv 移动
    const result = await sshService.exec(`mv "${sourcePath}" "${targetPath}"`);
    
    if (result.success || result.code === 0) {
      res.json({ success: true, message: '移动成功' });
    } else {
      res.status(500).json({ error: '移动失败: ' + (result.output || '未知错误') });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
