
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db/database');
const SshFtpService = require('../services/ssh-ftp');
const WorkerPool = require('../utils/worker-pool');
const sshPool = require('../utils/ssh-connection-pool');
const { UPLOAD_PUBLIC_PATH, isProtectedPath, shouldHideInList, UPLOAD_SCRIPT, scriptRelPath } = require('../services/upload-system-files');
const pathPosix = require('path').posix;

const router = express.Router();

// 创建工作线程池（用于文件操作）
const fileOperationPool = new WorkerPool(
  path.join(__dirname, '../workers/file-operation-worker.js'),
  require('os').cpus().length
);

// 配置 multer 用于处理文件上传（存储在内存中）
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 * 1024 } // 1GB 限制
});

// 计算域名的授权码 (MD5完整32位小写)
function getDomainAuthCode(domain) {
  return crypto.createHash('md5').update(domain).digest('hex').toLowerCase();
}

// PHP 直传 token：HMAC-SHA256(expires, UPLOAD_SIGN_SECRET)，与 upload.php 验签一致
function generateDirectUploadToken(expires) {
  const secret = process.env.UPLOAD_SIGN_SECRET || 'change_this_to_a_long_random_secret_string';
  return crypto.createHmac('sha256', secret).update(String(expires)).digest('hex');
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

// 获取 PHP 直传配置（前端用授权码换取直传地址 + 签名 token；脚本缺失时自动下发）
router.post('/direct-config', async (req, res) => {
  try {
    const { auth_code } = req.body;
    if (!auth_code) {
      return res.status(400).json({ error: '请输入授权码' });
    }

    const ftp = await findFtpByAuthCode(auth_code);
    if (!ftp) {
      return res.status(401).json({ error: '授权码无效或已禁用' });
    }

    let scriptStatus = 'skipped';
    let scriptMessage = '';
    let uploadUrl = UPLOAD_PUBLIC_PATH;
    let phpFix = null;

    if (ftp.ip && ftp.home_dir) {
      const SshFtpService = require('../services/ssh-ftp');
      const { deployUploadScript, ensureSitePhpAfterDeploy } = require('../services/deploy-upload-script');
      const sshService = new SshFtpService({
        ip: ftp.ip,
        port: ftp.ssh_port,
        username: ftp.ssh_user,
        password: ftp.ssh_pass
      });

      const newScript = pathPosix.join(ftp.home_dir, scriptRelPath());
      const legacyScript = pathPosix.join(ftp.home_dir, UPLOAD_SCRIPT);
      const check = await sshService.exec(
        `[ -f ${JSON.stringify(newScript)} ] && echo new || ([ -f ${JSON.stringify(legacyScript)} ] && echo legacy || echo missing)`
      );
      const found = (check.output || '').trim();

      if (found === 'new') {
        scriptStatus = 'exists';
        scriptMessage = '_vhost/upload.php 已存在';
        uploadUrl = UPLOAD_PUBLIC_PATH;
        console.log(`[直传] ${ftp.full_domain} ${scriptMessage}，跳过下发`);
      } else if (found === 'legacy') {
        console.log(`[直传] ${ftp.full_domain} 发现旧版 upload.php，迁移到 _vhost/...`);
        const deploy = await deployUploadScript(sshService, ftp.home_dir);
        if (deploy.success) {
          scriptStatus = 'migrated';
          scriptMessage = '已从旧版迁移到 _vhost/upload.php';
          uploadUrl = UPLOAD_PUBLIC_PATH;
          console.log(`[直传] ${ftp.full_domain} 迁移成功: ${deploy.remotePath}`);
        } else {
          scriptStatus = 'exists_legacy';
          scriptMessage = `旧版可用，迁移失败: ${deploy.message}`;
          uploadUrl = `/${UPLOAD_SCRIPT}`;
          console.warn(`[直传] ${ftp.full_domain} 迁移失败，暂用旧版路径: ${uploadUrl}`);
        }
      } else {
        console.log(`[直传] ${ftp.full_domain} 直传脚本不存在，自动下发...`);
        const deploy = await deployUploadScript(sshService, ftp.home_dir);
        if (deploy.success) {
          scriptStatus = 'deployed';
          scriptMessage = deploy.message;
          uploadUrl = UPLOAD_PUBLIC_PATH;
          console.log(`[直传] ${ftp.full_domain} 自动下发成功: ${deploy.remotePath}`);
        } else {
          scriptStatus = 'failed';
          scriptMessage = deploy.message;
          console.error(`[直传] ${ftp.full_domain} 自动下发失败: ${deploy.message}`);
        }
      }

      // 补齐 nginx PHP 配置（老站点可能缺 PHP 段或 sock 路径错误导致 502）
      try {
        phpFix = await ensureSitePhpAfterDeploy(sshService, ftp.full_domain, ftp.nginx_path);
        if (phpFix.success) {
          console.log(`[直传] ${ftp.full_domain} PHP 配置: ${phpFix.message}`);
        } else {
          console.warn(`[直传] ${ftp.full_domain} PHP 配置补齐失败: ${phpFix.message}`);
        }
      } catch (phpErr) {
        console.warn(`[直传] ${ftp.full_domain} PHP 配置补齐异常:`, phpErr.message);
      }
    } else {
      scriptStatus = 'no_server';
      scriptMessage = '未绑定服务器或缺少站点目录';
      console.warn(`[直传] ${ftp.full_domain} ${scriptMessage}`);
    }

    const expires = Math.floor(Date.now() / 1000) + 24 * 3600;
    const token = generateDirectUploadToken(expires);

    res.json({
      success: true,
      upload_url: uploadUrl,
      domain: ftp.full_domain,
      token,
      expires,
      script_status: scriptStatus,
      script_message: scriptMessage,
      php_fix: phpFix
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
           sv.ip, sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass,
           sv.nginx_path
    FROM ftp_accounts f
    LEFT JOIN subdomains s ON f.subdomain_id = s.id
    LEFT JOIN domains d ON s.domain_id = d.id
    LEFT JOIN servers sv ON s.server_id = sv.id
    WHERE f.status = 'active' AND (s.use_status IS NULL OR s.use_status != 'disabled')
  `);
  
  const inputCode = auth_code.toLowerCase();
  return ftpAccounts.find(f => getDomainAuthCode(f.full_domain) === inputCode);
}

// 获取空间使用情况（使用连接池优化）
router.post('/usage', async (req, res) => {
  try {
    const { auth_code } = req.body;
    
    const ftp = await findFtpByAuthCode(auth_code);
    
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }
    
    const config = {
      ip: ftp.ip,
      port: ftp.ssh_port,
      username: ftp.ssh_user,
      password: ftp.ssh_pass
    };
    
    const result = await sshPool.exec(config, `du -sb "${ftp.home_dir}" 2>/dev/null | cut -f1`);
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

// 获取文件列表（使用连接池优化）
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
    
    // 确保路径在home_dir内
    const targetPath = dirPath ? path.join(ftp.home_dir, dirPath) : ftp.home_dir;
    if (!targetPath.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权访问该目录' });
    }
    
    // 使用连接池执行命令
    const config = {
      ip: ftp.ip,
      port: ftp.ssh_port,
      username: ftp.ssh_user,
      password: ftp.ssh_pass
    };
    
    const result = await sshPool.exec(config, `ls -la "${targetPath}" 2>/dev/null | tail -n +2`);
    
    if (!result.success) {
      return res.json({ files: [], current_path: dirPath || '/' });
    }
    
    const files = result.output.split('\n').filter(line => line.trim()).map(line => {
      const parts = line.split(/\s+/);
      if (parts.length < 9) return null;
      
      const permissions = parts[0];
      const size = parseInt(parts[4]) || 0;
      // ls -la 输出格式: 月 日 时间/年份
      // 例如: Jan 15 10:30 或 Jan 15  2024
      const month = parts[5];
      const day = parts[6];
      const timeOrYear = parts[7];
      
      // 构建标准日期字符串
      let dateStr;
      if (timeOrYear.includes(':')) {
        // 包含时间，说明是今年的文件
        const currentYear = new Date().getFullYear();
        dateStr = `${currentYear} ${month} ${day} ${timeOrYear}`;
      } else {
        // 是年份，说明是去年或更早的文件
        dateStr = `${timeOrYear} ${month} ${day} 00:00`;
      }
      
      const name = parts.slice(8).join(' ');
      
      if (name === '.' || name === '..') return null;
      if (shouldHideInList(name, dirPath || '')) return null;
      
      return {
        name,
        type: permissions.startsWith('d') ? 'directory' : 'file',
        size,
        date: new Date(dateStr).toISOString(),
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
    if (dirPath && isProtectedPath(dirPath)) {
      return res.status(403).json({ error: '不可上传到系统目录' });
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
    if (dirPath && isProtectedPath(dirPath)) {
      return res.status(403).json({ error: '不可上传到系统目录' });
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
    const relDir = dirPath ? (dirPath + (name ? '/' + name : '')) : name;
    if (isProtectedPath(relDir) || (dirPath && isProtectedPath(dirPath))) {
      return res.status(403).json({ error: '不可在系统目录下创建' });
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
    const relFile = dirPath ? `${dirPath}/${name}` : name;
    if (isProtectedPath(relFile) || (dirPath && isProtectedPath(dirPath))) {
      return res.status(403).json({ error: '不可在系统目录下创建文件' });
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
    if (isProtectedPath(filePath)) {
      return res.status(403).json({ error: '系统文件不可删除' });
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
    if (isProtectedPath(filePath)) {
      return res.status(403).json({ error: '系统文件不可访问' });
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
    if (isProtectedPath(filePath)) {
      return res.status(403).json({ error: '系统文件不可访问' });
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
    if (isProtectedPath(filePath)) {
      return res.status(403).json({ error: '系统文件不可修改' });
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
    if (isProtectedPath(oldPath) || isProtectedPath(newPath)) {
      return res.status(403).json({ error: '系统文件不可修改' });
    }
    
    const result = await sshService.exec(`mv "${targetOldPath}" "${targetNewPath}"`);
    
    res.json({ success: result.success, message: result.success ? '重命名成功' : '重命名失败' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 解压文件（使用工作线程）
router.post('/extract', async (req, res) => {
  try {
    const { auth_code, path: filePath, target_dir } = req.body;
    
    const ftp = await findFtpByAuthCode(auth_code);
    
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }
    
    const targetFile = path.join(ftp.home_dir, filePath);
    if (!targetFile.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权访问该文件' });
    }
    if (isProtectedPath(filePath) || (target_dir && isProtectedPath(target_dir))) {
      return res.status(403).json({ error: '系统目录不可操作' });
    }
    
    // 确定解压目标目录
    const extractDir = target_dir 
      ? path.join(ftp.home_dir, target_dir)
      : path.dirname(targetFile);
    
    if (!extractDir.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权访问该目录' });
    }
    
    // 检查文件类型
    const ext = path.extname(targetFile).toLowerCase();
    const supportedFormats = ['.zip', '.gz', '.tgz', '.tar', '.7z'];
    
    if (!supportedFormats.includes(ext)) {
      return res.status(400).json({ error: '不支持的压缩格式，仅支持 .zip, .tar.gz, .tar, .7z' });
    }
    
    // 使用工作线程处理解压
    const result = await fileOperationPool.exec({
      operation: 'extract',
      config: {
        ip: ftp.ip,
        port: ftp.ssh_port,
        username: ftp.ssh_user,
        password: ftp.ssh_pass
      },
      params: {
        targetFile,
        extractDir
      }
    });
    
    if (result.success) {
      res.json({ success: true, message: result.result.message });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 压缩文件/目录（使用工作线程）
router.post('/compress', async (req, res) => {
  try {
    const { auth_code, paths, archive_name, format } = req.body;
    
    const ftp = await findFtpByAuthCode(auth_code);
    
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }
    
    // 验证所有路径
    const fullPaths = paths.map(p => path.join(ftp.home_dir, p));
    if (!fullPaths.every(p => p.startsWith(ftp.home_dir))) {
      return res.status(403).json({ error: '无权访问某些文件' });
    }
    if (paths.some(p => isProtectedPath(p))) {
      return res.status(403).json({ error: '系统文件不可压缩' });
    }
    
    const archiveFormat = format || 'zip';
    
    // 使用工作线程处理压缩
    const result = await fileOperationPool.exec({
      operation: 'compress',
      config: {
        ip: ftp.ip,
        port: ftp.ssh_port,
        username: ftp.ssh_user,
        password: ftp.ssh_pass
      },
      params: {
        homeDir: ftp.home_dir,
        paths,
        archiveName: archive_name,
        format: archiveFormat
      }
    });
    
    if (result.success) {
      res.json({ success: true, message: result.result.message, archive: result.result.archive });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 复制文件/目录（使用工作线程）
router.post('/copy', async (req, res) => {
  try {
    const { auth_code, source_path, target_path } = req.body;
    
    const ftp = await findFtpByAuthCode(auth_code);
    
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }
    
    const sourcePath = path.join(ftp.home_dir, source_path);
    const targetPath = path.join(ftp.home_dir, target_path);
    
    if (!sourcePath.startsWith(ftp.home_dir) || !targetPath.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权操作该文件' });
    }
    if (isProtectedPath(source_path) || isProtectedPath(target_path)) {
      return res.status(403).json({ error: '系统文件不可复制' });
    }
    
    // 使用工作线程处理复制
    const result = await fileOperationPool.exec({
      operation: 'copy',
      config: {
        ip: ftp.ip,
        port: ftp.ssh_port,
        username: ftp.ssh_user,
        password: ftp.ssh_pass
      },
      params: {
        sourcePath,
        targetPath
      }
    });
    
    if (result.success) {
      res.json({ success: true, message: result.result.message });
    } else {
      res.status(500).json({ error: result.error });
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
    if (isProtectedPath(source_path) || isProtectedPath(target_path)) {
      return res.status(403).json({ error: '系统文件不可移动' });
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
