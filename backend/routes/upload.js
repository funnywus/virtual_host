
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db/database');
const SshFtpService = require('../services/ssh-ftp');
const WorkerPool = require('../utils/worker-pool');
const sshPool = require('../utils/ssh-connection-pool');
const { UPLOAD_PUBLIC_PATH, isProtectedPath, shouldHideInList, UPLOAD_SCRIPT, scriptRelPath, normalizeRelPath } = require('../services/upload-system-files');
const pathPosix = require('path').posix;
const { domainAuthCode, matchAuthCode } = require('../services/ftp-auth');

const router = express.Router();

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** 清理远程文件名：去掉路径穿越与控制字符，保留中文等 Unicode */
function sanitizeRemoteFilename(name) {
  let base = String(name || '').replace(/\\/g, '/');
  base = pathPosix.basename(base);
  base = base.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (!base || base === '.' || base === '..') {
    base = `file_${Date.now()}`;
  }
  return base;
}

function remoteAbs(homeDir, ...parts) {
  const cleaned = parts
    .filter(p => p != null && p !== '')
    .map(p => String(p).replace(/\\/g, '/').replace(/^\/+/, ''));
  return pathPosix.join(homeDir, ...cleaned);
}

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

// 计算域名的授权码（兼容旧数据回退）
function getDomainAuthCode(domain) {
  return domainAuthCode(domain);
}

// PHP 直传 token：HMAC-SHA256(expires, UPLOAD_SIGN_SECRET)，与 upload.php 验签一致
function generateDirectUploadToken(expires) {
  const secret = process.env.UPLOAD_SIGN_SECRET || 'change_this_to_a_long_random_secret_string';
  return crypto.createHmac('sha256', secret).update(String(expires)).digest('hex');
}

// 根据授权码查找 FTP 账号（优先库内 auth_code，兼容历史域名 MD5）
async function findFtpByAuthCode(auth_code, { includeDisabled = false } = {}) {
  const statusClause = includeDisabled
    ? ''
    : ` AND (s.use_status IS NULL OR s.use_status != 'disabled')`;

  const ftpAccounts = await db.all(`
    SELECT f.*, s.id as subdomain_id, s.subdomain, s.expire_at, s.use_status, s.activated_at, s.duration_days,
           d.domain as main_domain,
           CASE WHEN s.subdomain = '@' THEN d.domain ELSE ${db.concat('s.subdomain', `'.'`, 'd.domain')} END as full_domain,
           sv.ip, sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass,
           sv.nginx_path
    FROM ftp_accounts f
    LEFT JOIN subdomains s ON f.subdomain_id = s.id
    LEFT JOIN domains d ON s.domain_id = d.id
    LEFT JOIN servers sv ON s.server_id = sv.id
    WHERE f.status = 'active'${statusClause}
  `);

  return ftpAccounts.find(f => matchAuthCode(f, auth_code));
}

// 通过授权码验证
router.post('/auth', async (req, res) => {
  try {
    const { auth_code } = req.body;
    
    if (!auth_code) {
      return res.status(400).json({ error: '请输入授权码' });
    }

    const ftp = await findFtpByAuthCode(auth_code, { includeDisabled: true });
    
    if (!ftp) {
      return res.status(401).json({ error: '授权码无效', code: 'invalid_auth' });
    }

    if (ftp.use_status === 'disabled') {
      return res.status(403).json({
        error: '该域名已停用，请联系管理员续费或处理',
        code: 'disabled',
        domain: ftp.full_domain
      });
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
    let reachability = null;

    if (ftp.ip && ftp.home_dir) {
      const SshFtpService = require('../services/ssh-ftp');
      const { deployUploadScript, ensureSitePhpAfterDeploy, probeDirectUploadLocal } = require('../services/deploy-upload-script');
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

      // 本机探测：区分脚本问题 vs 公网 HTTPS/证书问题
      try {
        reachability = await probeDirectUploadLocal(sshService, ftp.full_domain, uploadUrl);
        console.log(`[直传] ${ftp.full_domain} 本机探测:`, reachability.message);
      } catch (reachErr) {
        reachability = { ok: false, message: '本机探测异常: ' + reachErr.message };
        console.warn(`[直传] ${ftp.full_domain} 本机探测异常:`, reachErr.message);
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
      php_fix: phpFix,
      reachability
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 通用函数：根据授权码查找FTP账号（正常业务接口不包含已停用账号）

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

// 格式化文件大小
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
}

const MAX_SEARCH_RESULTS = 2000;

function buildRelPath(dirPath, name) {
  const base = normalizeRelPath(dirPath);
  return base ? `${base}/${name}` : name;
}

function escapeFindPattern(keyword) {
  return keyword.replace(/\\/g, '\\\\').replace(/[*?[]/g, '\\$&').replace(/'/g, "'\\''");
}

function sortFileEntries(files, sortBy = 'name', sortOrder = 'asc') {
  const dir = sortOrder === 'desc' ? -1 : 1;
  files.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    if (sortBy === 'size') {
      if (a.size !== b.size) return (a.size - b.size) * dir;
      return a.name.localeCompare(b.name);
    }
    if (sortBy === 'date') {
      const at = new Date(a.date).getTime();
      const bt = new Date(b.date).getTime();
      if (at !== bt) return (at - bt) * dir;
      return a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name) * dir;
  });
  return files;
}

function parseLsOutput(output, dirPath) {
  return output.split('\n').filter(line => line.trim()).map(line => {
    const parts = line.split(/\s+/);
    if (parts.length < 9) return null;

    const permissions = parts[0];
    const size = parseInt(parts[4]) || 0;
    const month = parts[5];
    const day = parts[6];
    const timeOrYear = parts[7];

    let dateStr;
    if (timeOrYear.includes(':')) {
      const currentYear = new Date().getFullYear();
      dateStr = `${currentYear} ${month} ${day} ${timeOrYear}`;
    } else {
      dateStr = `${timeOrYear} ${month} ${day} 00:00`;
    }

    const name = parts.slice(8).join(' ');
    if (name === '.' || name === '..') return null;
    if (shouldHideInList(name, dirPath || '')) return null;

    return {
      name,
      rel_path: buildRelPath(dirPath || '', name),
      type: permissions.startsWith('d') ? 'directory' : 'file',
      size,
      date: new Date(dateStr).toISOString(),
      permissions
    };
  }).filter(Boolean);
}

async function searchInSubdirs(config, targetPath, dirPath, keyword) {
  const pattern = escapeFindPattern(keyword);
  const relBase = normalizeRelPath(dirPath);
  const cmd = `find "${targetPath}" \\( -type f -o -type d \\) -iname '*${pattern}*' -printf '%y\\t%s\\t%T@\\t%P\\n' 2>/dev/null`;
  const result = await sshPool.exec(config, cmd);
  if (!result.success || !result.output) return { files: [], truncated: false };

  const files = [];
  for (const line of result.output.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 4) continue;

    const typeChar = parts[0];
    const size = parseInt(parts[1], 10) || 0;
    const mtime = parseFloat(parts[2]);
    const relFromCurrent = parts.slice(3).join('\t').replace(/\\/g, '/');
    const fullRel = relBase ? `${relBase}/${relFromCurrent}` : relFromCurrent;
    const normalizedRel = normalizeRelPath(fullRel);

    if (isProtectedPath(normalizedRel)) continue;

    const name = pathPosix.basename(relFromCurrent);
    const parentRel = pathPosix.dirname(normalizedRel);
    if (shouldHideInList(name, parentRel === '.' ? '' : parentRel)) continue;

    files.push({
      name,
      rel_path: normalizedRel,
      type: typeChar === 'd' ? 'directory' : 'file',
      size,
      date: new Date(mtime * 1000).toISOString(),
      permissions: typeChar === 'd' ? 'drwxr-xr-x' : '-rw-r--r--'
    });
  }

  // 排序在调用方按用户选择的字段执行，此处仅截断
  sortFileEntries(files); // 默认按名称排序，保证截断前顺序稳定
  const truncated = files.length > MAX_SEARCH_RESULTS;
  if (truncated) files.length = MAX_SEARCH_RESULTS;
  return { files, truncated };
}

// 获取文件列表（使用连接池优化，支持分页）
router.post('/list', async (req, res) => {
  try {
    const { auth_code, path: dirPath, page: pageRaw, pageSize: pageSizeRaw, keyword: keywordRaw, search_subdirs: searchSubdirsRaw, sort_by: sortByRaw, sort_order: sortOrderRaw } = req.body;
    const page = Math.max(1, parseInt(pageRaw, 10) || 1);
    const pageSize = Math.min(500, Math.max(1, parseInt(pageSizeRaw, 10) || 10));
    const keyword = typeof keywordRaw === 'string' ? keywordRaw.trim().toLowerCase() : '';
    const search_subdirs = !!searchSubdirsRaw && !!keyword;
    const sortBy = ['name', 'size', 'date'].includes(sortByRaw) ? sortByRaw : 'name';
    const sortOrder = sortOrderRaw === 'desc' ? 'desc' : 'asc';
    
    const ftp = await findFtpByAuthCode(auth_code);
    
    if (!ftp) {
      return res.status(401).json({ error: '授权码无效' });
    }
    
    if (!ftp.ip) {
      return res.status(400).json({ error: '服务器未配置' });
    }
    
    // 确保路径在home_dir内
    const targetPath = dirPath ? remoteAbs(ftp.home_dir, dirPath) : ftp.home_dir;
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
    
    const result = await sshPool.exec(config, `ls -la -- ${shellQuote(targetPath)} 2>/dev/null | tail -n +2`);
    const dirFiles = result.success ? parseLsOutput(result.output, dirPath || '') : [];
    const file_count = dirFiles.filter(f => f.type === 'file').length;
    const folder_count = dirFiles.filter(f => f.type === 'directory').length;

    if (!result.success && !(keyword && search_subdirs)) {
      return res.json({
        files: [],
        current_path: dirPath || '/',
        total: 0,
        page,
        pageSize,
        file_count: 0,
        folder_count: 0,
        keyword,
        search_subdirs
      });
    }

    let files = [];
    let search_truncated = false;

    if (keyword && search_subdirs) {
      const searchResult = await searchInSubdirs(config, targetPath, dirPath || '', keyword);
      files = searchResult.files;
      search_truncated = searchResult.truncated;
      sortFileEntries(files, sortBy, sortOrder);
    } else {
      files = keyword
        ? dirFiles.filter(f => f.name.toLowerCase().includes(keyword))
        : dirFiles;
      sortFileEntries(files, sortBy, sortOrder);
    }

    const filtered = files;
    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const pagedFiles = filtered.slice(start, start + pageSize);

    res.json({
      files: pagedFiles,
      current_path: dirPath || '/',
      total,
      page,
      pageSize,
      file_count,
      folder_count,
      keyword,
      search_subdirs,
      search_truncated
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取全空间目录树（用于"移动到..."目录选择器）
router.post('/folders', async (req, res) => {
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

    // 只列目录，深度不限，按路径排序方便前端构建树
    const result = await sshPool.exec(
      config,
      `find "${ftp.home_dir}" -type d -printf '%P\\n' 2>/dev/null | sort`
    );

    const folders = [];
    if (result.success && result.output) {
      for (const line of result.output.split('\n')) {
        const rel = normalizeRelPath(line);
        if (!rel) continue; // 根目录本身跳过，前端单独表示"根目录"
        if (isProtectedPath(rel)) continue;
        const name = pathPosix.basename(rel);
        const parentRel = pathPosix.dirname(rel);
        if (shouldHideInList(name, parentRel === '.' ? '' : parentRel)) continue;
        folders.push(rel);
      }
    }

    res.json({ folders });
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
    const targetDir = dirPath ? pathPosix.join(ftp.home_dir, dirPath) : ftp.home_dir;
    if (!targetDir.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权访问该目录' });
    }
    if (dirPath && isProtectedPath(dirPath)) {
      return res.status(403).json({ error: '不可上传到系统目录' });
    }
    
    const targetFile = pathPosix.join(targetDir, sanitizeRemoteFilename(filename));
    
    // 先创建目录（如果不存在）
    await sshService.exec(`mkdir -p -- ${shellQuote(targetDir)}`);
    
    // 使用SFTP上传文件（支持大文件）
    try {
      await sshService.uploadFile(fileBuffer, targetFile);
    } catch (uploadErr) {
      return res.status(500).json({ error: '上传失败: ' + uploadErr.message });
    }
    
    // 设置权限 755 和所有者 www（shellQuote 保证中文路径安全）
    await sshService.exec(`chmod 755 -- ${shellQuote(targetFile)}`);
    await sshService.exec(`chown www:www -- ${shellQuote(targetFile)} 2>/dev/null || chown www -- ${shellQuote(targetFile)} 2>/dev/null`);
    await sshService.exec(`chmod 755 -- ${shellQuote(targetDir)}`);
    await sshService.exec(`chown www:www -- ${shellQuote(targetDir)} 2>/dev/null || chown www -- ${shellQuote(targetDir)} 2>/dev/null`);
    
    res.json({ success: true, message: '上传成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
    const targetDir = dirPath ? pathPosix.join(ftp.home_dir, dirPath) : ftp.home_dir;
    if (!targetDir.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权访问该目录' });
    }
    if (dirPath && isProtectedPath(dirPath)) {
      return res.status(403).json({ error: '不可上传到系统目录' });
    }

    // filename 字段优先；否则解码 multer 可能误解析为 latin1 的 originalname
    let uploadName = filename;
    if (!uploadName && file.originalname) {
      uploadName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    }
    const targetFile = pathPosix.join(targetDir, sanitizeRemoteFilename(uploadName || file.originalname));
    
    // 先创建目录（如果不存在）
    await sshService.exec(`mkdir -p -- ${shellQuote(targetDir)}`);
    
    // 使用SFTP上传文件（支持大文件）
    try {
      await sshService.uploadFile(file.buffer, targetFile);
    } catch (uploadErr) {
      return res.status(500).json({ error: '上传失败: ' + uploadErr.message });
    }
    
    // 设置权限 644 和所有者 www
    await sshService.exec(`chmod 644 -- ${shellQuote(targetFile)}`);
    await sshService.exec(`chown www:www -- ${shellQuote(targetFile)} 2>/dev/null || chown www -- ${shellQuote(targetFile)} 2>/dev/null`);
    await sshService.exec(`chmod 755 -- ${shellQuote(targetDir)}`);
    await sshService.exec(`chown www:www -- ${shellQuote(targetDir)} 2>/dev/null || chown www -- ${shellQuote(targetDir)} 2>/dev/null`);
    
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
    
    const safeName = sanitizeRemoteFilename(name);
    const targetDir = remoteAbs(ftp.home_dir, dirPath, safeName);
    if (!targetDir.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权访问该目录' });
    }
    const relDir = dirPath ? (dirPath + (safeName ? '/' + safeName : '')) : safeName;
    if (isProtectedPath(relDir) || (dirPath && isProtectedPath(dirPath))) {
      return res.status(403).json({ error: '不可在系统目录下创建' });
    }
    
    const result = await sshService.exec(`mkdir -p -- ${shellQuote(targetDir)}`);
    
    // 设置权限 755 和所有者 www
    if (result.success) {
      await sshService.exec(`chmod 755 -- ${shellQuote(targetDir)}`);
      await sshService.exec(`chown www:www -- ${shellQuote(targetDir)} 2>/dev/null || chown www -- ${shellQuote(targetDir)} 2>/dev/null`);
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
    
    const safeName = sanitizeRemoteFilename(name);
    const targetFile = remoteAbs(ftp.home_dir, dirPath, safeName);
    if (!targetFile.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权访问该目录' });
    }
    const relFile = dirPath ? `${dirPath}/${safeName}` : safeName;
    if (isProtectedPath(relFile) || (dirPath && isProtectedPath(dirPath))) {
      return res.status(403).json({ error: '不可在系统目录下创建文件' });
    }
    
    // 使用 cat 写入文件内容，转义特殊字符
    const escapedContent = (content || '').replace(/'/g, "'\\''");
    const result = await sshService.exec(`cat > ${shellQuote(targetFile)} << 'EOFCONTENT'\n${escapedContent}\nEOFCONTENT`);
    
    // 设置权限 644 和所有者 www
    await sshService.exec(`chmod 644 -- ${shellQuote(targetFile)}`);
    await sshService.exec(`chown www:www -- ${shellQuote(targetFile)} 2>/dev/null || chown www -- ${shellQuote(targetFile)} 2>/dev/null`);
    
    res.json({ success: true, message: '创建成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除文件/目录（支持 path 单条或 paths 批量）
router.post('/delete', async (req, res) => {
  try {
    const { auth_code, path: filePath, paths } = req.body;

    const pathList = Array.isArray(paths) && paths.length
      ? paths
      : (filePath ? [filePath] : []);

    if (!pathList.length) {
      return res.status(400).json({ error: '未指定要删除的路径' });
    }

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

    const targetPaths = [];
    for (const relPath of pathList) {
      const targetPath = remoteAbs(ftp.home_dir, relPath);
      if (!targetPath.startsWith(ftp.home_dir) || targetPath === ftp.home_dir) {
        return res.status(403).json({ error: '无权删除该文件' });
      }
      if (isProtectedPath(relPath)) {
        return res.status(403).json({ error: '系统文件不可删除' });
      }
      targetPaths.push(targetPath);
    }

    const quoted = targetPaths.map(p => shellQuote(p)).join(' ');
    const result = await sshService.exec(`rm -rf -- ${quoted}`);

    res.json({
      success: result.success,
      deleted: pathList.length,
      message: result.success ? '删除成功' : '删除失败'
    });
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
    
    const targetPath = remoteAbs(ftp.home_dir, filePath);
    if (!targetPath.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权访问该文件' });
    }
    if (isProtectedPath(filePath)) {
      return res.status(403).json({ error: '系统文件不可访问' });
    }
    
    const result = await sshService.exec(`cat -- ${shellQuote(targetPath)} 2>/dev/null`);
    
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
    
    const targetPath = remoteAbs(ftp.home_dir, filePath);
    if (!targetPath.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权访问该文件' });
    }
    if (isProtectedPath(filePath)) {
      return res.status(403).json({ error: '系统文件不可访问' });
    }
    
    const result = await sshService.exec(`base64 -- ${shellQuote(targetPath)} 2>/dev/null | tr -d '\\n'`);
    
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
    
    const targetPath = remoteAbs(ftp.home_dir, filePath);
    if (!targetPath.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权访问该文件' });
    }
    if (isProtectedPath(filePath)) {
      return res.status(403).json({ error: '系统文件不可修改' });
    }
    
    // 将内容转为base64后写入，避免特殊字符问题
    const base64Content = Buffer.from(content, 'utf-8').toString('base64');
    const result = await sshService.exec(`echo ${shellQuote(base64Content)} | base64 -d > ${shellQuote(targetPath)}`);
    
    if (result.success || result.code === 0) {
      // 设置权限
      await sshService.exec(`chmod 644 -- ${shellQuote(targetPath)}`);
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
    
    const targetOldPath = remoteAbs(ftp.home_dir, oldPath);
    const targetNewPath = remoteAbs(ftp.home_dir, newPath);
    
    if (!targetOldPath.startsWith(ftp.home_dir) || !targetNewPath.startsWith(ftp.home_dir)) {
      return res.status(403).json({ error: '无权操作该文件' });
    }
    if (isProtectedPath(oldPath) || isProtectedPath(newPath)) {
      return res.status(403).json({ error: '系统文件不可修改' });
    }
    
    const result = await sshService.exec(`mv -- ${shellQuote(targetOldPath)} ${shellQuote(targetNewPath)}`);
    
    res.json({ success: result.success, message: result.success ? '重命名成功' : '重命名失败' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function contentDisposition(filename) {
  const ascii = String(filename || 'download')
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename || 'download');
  return `attachment; filename="${ascii || 'download'}"; filename*=UTF-8''${encoded}`;
}

// 打包下载到浏览器：单文件直传；多文件/目录先在远端 zip 再流式返回
router.post('/download', async (req, res) => {
  let tmpZip = null;
  let sshService = null;
  try {
    const { auth_code, paths } = req.body;
    const pathList = Array.isArray(paths) ? paths.filter(Boolean) : [];
    if (!pathList.length) {
      return res.status(400).json({ error: '未指定下载路径' });
    }
    if (pathList.length > 200) {
      return res.status(400).json({ error: '一次最多下载 200 个路径' });
    }

    const ftp = await findFtpByAuthCode(auth_code);
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }

    for (const rel of pathList) {
      const abs = remoteAbs(ftp.home_dir, rel);
      if (!abs.startsWith(ftp.home_dir) || abs === ftp.home_dir) {
        return res.status(403).json({ error: '无权下载该路径' });
      }
      if (isProtectedPath(rel)) {
        return res.status(403).json({ error: '系统文件不可下载' });
      }
    }

    sshService = new SshFtpService({
      ip: ftp.ip,
      port: ftp.ssh_port,
      username: ftp.ssh_user,
      password: ftp.ssh_pass
    });

    // 单文件且是普通文件：直接流式下载
    if (pathList.length === 1) {
      const abs = remoteAbs(ftp.home_dir, pathList[0]);
      const typeCheck = await sshService.exec(
        `if [ -d ${shellQuote(abs)} ]; then echo dir; elif [ -f ${shellQuote(abs)} ]; then echo file; else echo missing; fi`
      );
      const kind = (typeCheck.output || '').trim();
      if (kind === 'missing') {
        return res.status(404).json({ error: '文件不存在' });
      }
      if (kind === 'file') {
        const name = pathPosix.basename(pathList[0]);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', contentDisposition(name));
        req.setTimeout(0);
        res.setTimeout(0);
        await sshService.streamRemoteFile(abs, res);
        return;
      }
      // 目录走 zip
    }

    // 多选或目录：远端 zip
    tmpZip = `/tmp/vhost_dl_${crypto.randomBytes(8).toString('hex')}.zip`;
    const relArgs = pathList.map(p => shellQuote(String(p).replace(/^\/+/, ''))).join(' ');
    const zipCmd = `cd ${shellQuote(ftp.home_dir)} && zip -r -q ${shellQuote(tmpZip)} ${relArgs}`;
    const zipResult = await sshService.exec(zipCmd, 600000);
    if (!zipResult.success) {
      await sshService.exec(`rm -f -- ${shellQuote(tmpZip)}`).catch(() => {});
      return res.status(500).json({ error: '打包失败: ' + (zipResult.output || '未知错误') });
    }

    const sizeCheck = await sshService.exec(`stat -c%s ${shellQuote(tmpZip)} 2>/dev/null || wc -c < ${shellQuote(tmpZip)}`);
    const zipSize = parseInt(String(sizeCheck.output || '').trim(), 10) || 0;
    const maxZip = 1024 * 1024 * 1024; // 1GB
    if (zipSize > maxZip) {
      await sshService.exec(`rm -f -- ${shellQuote(tmpZip)}`);
      return res.status(400).json({ error: '打包后超过 1GB，请缩小选择范围' });
    }

    let downloadName = 'files.zip';
    if (pathList.length === 1) {
      downloadName = `${pathPosix.basename(pathList[0])}.zip`;
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', contentDisposition(downloadName));
    if (zipSize > 0) res.setHeader('Content-Length', String(zipSize));
    req.setTimeout(0);
    res.setTimeout(0);

    res.on('close', () => {
      if (tmpZip && sshService) {
        sshService.exec(`rm -f -- ${shellQuote(tmpZip)}`).catch(() => {});
        tmpZip = null;
      }
    });

    await sshService.streamRemoteFile(tmpZip, res);
    if (tmpZip) {
      await sshService.exec(`rm -f -- ${shellQuote(tmpZip)}`).catch(() => {});
      tmpZip = null;
    }
  } catch (err) {
    if (tmpZip && sshService) {
      await sshService.exec(`rm -f -- ${shellQuote(tmpZip)}`).catch(() => {});
    }
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || '下载失败' });
    } else {
      res.end();
    }
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

function resolveTransferItems(body) {
  const { items, source_path, target_path } = body || {};
  if (Array.isArray(items) && items.length) {
    return items
      .filter(it => it && it.source_path != null && it.target_path != null)
      .map(it => ({
        source_path: normalizeRelPath(it.source_path),
        target_path: normalizeRelPath(it.target_path)
      }));
  }
  if (source_path != null && target_path != null) {
    return [{
      source_path: normalizeRelPath(source_path),
      target_path: normalizeRelPath(target_path)
    }];
  }
  return [];
}

function resolvePathList(body) {
  const { path: filePath, paths } = body || {};
  if (Array.isArray(paths) && paths.length) {
    return paths.map(p => normalizeRelPath(p)).filter(Boolean);
  }
  if (filePath) {
    const one = normalizeRelPath(filePath);
    return one ? [one] : [];
  }
  return [];
}

function createSshFromFtp(ftp) {
  return new SshFtpService({
    ip: ftp.ip,
    port: ftp.ssh_port,
    username: ftp.ssh_user,
    password: ftp.ssh_pass
  });
}

async function remotePathExists(sshService, absPath) {
  const result = await sshService.exec(`test -e ${shellQuote(absPath)} && echo 1 || echo 0`);
  return result.output?.trim() === '1';
}

async function applyDestPerms(sshService, destAbs) {
  await sshService.exec(`chmod -R 755 -- ${shellQuote(destAbs)} 2>/dev/null`);
  await sshService.exec(`find ${shellQuote(destAbs)} -type f -exec chmod 644 {} \\; 2>/dev/null`);
  await sshService.exec(
    `chown -R www:www -- ${shellQuote(destAbs)} 2>/dev/null || chown -R www -- ${shellQuote(destAbs)} 2>/dev/null`
  );
}

// 复制文件/目录（支持 source/target 单条或 items 批量，共用一条 SSH）
router.post('/copy', async (req, res) => {
  try {
    const { auth_code } = req.body;
    const itemList = resolveTransferItems(req.body);

    if (!itemList.length) {
      return res.status(400).json({ error: '未指定要复制的路径' });
    }

    const ftp = await findFtpByAuthCode(auth_code);
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }

    const prepared = [];
    for (const item of itemList) {
      const sourcePath = remoteAbs(ftp.home_dir, item.source_path);
      const targetPath = remoteAbs(ftp.home_dir, item.target_path);
      if (!sourcePath.startsWith(ftp.home_dir) || !targetPath.startsWith(ftp.home_dir)) {
        return res.status(403).json({ error: '无权操作该文件' });
      }
      if (isProtectedPath(item.source_path) || isProtectedPath(item.target_path)) {
        return res.status(403).json({ error: '系统文件不可复制' });
      }
      prepared.push({ sourcePath, targetPath, source_path: item.source_path, target_path: item.target_path });
    }

    const sshService = createSshFromFtp(ftp);
    let copied = 0;
    let failed = 0;
    const errors = [];

    for (const item of prepared) {
      const result = await sshService.exec(
        `cp -a -- ${shellQuote(item.sourcePath)} ${shellQuote(item.targetPath)}`
      );
      if (result.success || result.code === 0) {
        await applyDestPerms(sshService, item.targetPath);
        copied += 1;
      } else {
        failed += 1;
        errors.push({
          source_path: item.source_path,
          target_path: item.target_path,
          error: result.output || '复制失败'
        });
      }
    }

    if (itemList.length === 1 && failed > 0) {
      return res.status(500).json({ error: errors[0]?.error || '复制失败' });
    }

    res.json({
      success: failed === 0,
      copied,
      failed,
      errors,
      message: failed === 0 ? `成功复制 ${copied} 个项目` : `复制完成：成功 ${copied}，失败 ${failed}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 剪切（移动）文件/目录（支持 source/target 单条或 items 批量）
router.post('/cut', async (req, res) => {
  try {
    const { auth_code } = req.body;
    const itemList = resolveTransferItems(req.body);

    if (!itemList.length) {
      return res.status(400).json({ error: '未指定要移动的路径' });
    }

    const ftp = await findFtpByAuthCode(auth_code);
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }

    const prepared = [];
    for (const item of itemList) {
      const sourcePath = remoteAbs(ftp.home_dir, item.source_path);
      const targetPath = remoteAbs(ftp.home_dir, item.target_path);
      if (!sourcePath.startsWith(ftp.home_dir) || !targetPath.startsWith(ftp.home_dir)) {
        return res.status(403).json({ error: '无权操作该文件' });
      }
      if (isProtectedPath(item.source_path) || isProtectedPath(item.target_path)) {
        return res.status(403).json({ error: '系统文件不可移动' });
      }
      prepared.push({ sourcePath, targetPath, source_path: item.source_path, target_path: item.target_path });
    }

    const sshService = createSshFromFtp(ftp);
    let moved = 0;
    let failed = 0;
    const errors = [];

    for (const item of prepared) {
      const result = await sshService.exec(
        `mv -- ${shellQuote(item.sourcePath)} ${shellQuote(item.targetPath)}`
      );
      if (result.success || result.code === 0) {
        moved += 1;
      } else {
        failed += 1;
        errors.push({
          source_path: item.source_path,
          target_path: item.target_path,
          error: result.output || '移动失败'
        });
      }
    }

    if (itemList.length === 1 && failed > 0) {
      return res.status(500).json({ error: errors[0]?.error || '移动失败' });
    }

    res.json({
      success: failed === 0,
      moved,
      failed,
      errors,
      message: failed === 0 ? `成功移动 ${moved} 个项目` : `移动完成：成功 ${moved}，失败 ${failed}`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function inspectLiftFolder(sshService, ftp, folderPath) {
  if (isProtectedPath(folderPath)) {
    return { ok: false, error: '系统目录不可操作', status: 403 };
  }

  const targetFolder = remoteAbs(ftp.home_dir, folderPath);
  const parentDir = pathPosix.dirname(targetFolder);

  if (!targetFolder.startsWith(ftp.home_dir) || parentDir === targetFolder) {
    return { ok: false, error: '无权操作该目录', status: 403 };
  }

  const dirCheck = await sshService.exec(`test -d ${shellQuote(targetFolder)} && echo 1 || echo 0`);
  if (dirCheck.output?.trim() !== '1') {
    return { ok: false, error: '目标不是文件夹或不存在', status: 400 };
  }

  const listResult = await sshService.exec(`ls -A ${shellQuote(targetFolder)} 2>/dev/null`);
  const names = (listResult.output || '').split('\n').map(s => s.trim()).filter(Boolean)
    .filter(name => !shouldHideInList(name, folderPath));

  return {
    ok: true,
    folderPath,
    targetFolder,
    parentDir,
    names,
    parent_path: (() => {
      const parentRel = pathPosix.dirname(folderPath);
      return parentRel === '.' ? '' : parentRel;
    })()
  };
}

async function liftOneFolder(sshService, folderInfo, onConflict) {
  const { folderPath, targetFolder, parentDir, names } = folderInfo;
  let moved = 0;
  let skipped = 0;
  let overwritten = 0;
  let failed = 0;
  const errors = [];

  for (const name of names) {
    try {
      const source = remoteAbs(targetFolder, name);
      const dest = remoteAbs(parentDir, name);
      const exists = await remotePathExists(sshService, dest);

      if (exists) {
        if (onConflict === 'skip') {
          skipped += 1;
          continue;
        }
        const rmResult = await sshService.exec(`rm -rf -- ${shellQuote(dest)}`);
        if (!rmResult.success && rmResult.code !== 0) {
          failed += 1;
          errors.push(name);
          continue;
        }
        overwritten += 1;
      }

      const mvResult = await sshService.exec(`mv -- ${shellQuote(source)} ${shellQuote(dest)}`);
      if (mvResult.success || mvResult.code === 0) {
        moved += 1;
        await applyDestPerms(sshService, dest);
      } else {
        failed += 1;
        errors.push(name);
      }
    } catch {
      failed += 1;
      errors.push(name);
    }
  }

  return { path: folderPath, moved, skipped, overwritten, failed, errors };
}

function buildLiftMessage({ moved, skipped, overwritten, failed, folderCount }) {
  const parts = folderCount > 1
    ? [`已处理 ${folderCount} 个文件夹，共提取 ${moved} 项`]
    : [`已将 ${moved} 项提取到上级目录`];
  if (overwritten > 0) parts.push(`${overwritten} 项已覆盖`);
  if (skipped > 0) parts.push(`${skipped} 项因重名已跳过`);
  if (failed > 0) parts.push(`${failed} 项失败`);
  return failed === 0 ? parts.join('，') : `部分失败：${parts.join('，')}`;
}

// 检测提取到上级时的重名冲突（支持 path 单条或 paths 批量）
router.post('/lift-contents/check', async (req, res) => {
  try {
    const { auth_code } = req.body;
    const pathList = resolvePathList(req.body);

    if (!pathList.length) {
      return res.status(400).json({ error: '请指定文件夹' });
    }

    const ftp = await findFtpByAuthCode(auth_code);
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }

    const sshService = createSshFromFtp(ftp);
    const folders = [];
    const conflicts = [];
    const claimedNames = new Map(); // name -> first folderPath
    let total = 0;
    let parentPath = '';

    for (const folderPath of pathList) {
      const info = await inspectLiftFolder(sshService, ftp, folderPath);
      if (!info.ok) {
        if (pathList.length === 1) {
          return res.status(info.status || 400).json({ error: info.error });
        }
        folders.push({ path: folderPath, total: 0, conflicts: [], error: info.error });
        continue;
      }

      parentPath = info.parent_path;
      const folderConflicts = [];

      for (const name of info.names) {
        total += 1;
        const destPath = remoteAbs(info.parentDir, name);

        if (claimedNames.has(name)) {
          const conflict = {
            name,
            type: 'file',
            from: folderPath,
            reason: 'duplicate_in_batch'
          };
          folderConflicts.push(conflict);
          conflicts.push(conflict);
          continue;
        }
        claimedNames.set(name, folderPath);

        if (await remotePathExists(sshService, destPath)) {
          const typeResult = await sshService.exec(
            `test -d ${shellQuote(destPath)} && echo directory || echo file`
          );
          const conflict = {
            name,
            type: typeResult.output?.trim() === 'directory' ? 'directory' : 'file',
            from: folderPath
          };
          folderConflicts.push(conflict);
          conflicts.push(conflict);
        }
      }

      folders.push({
        path: folderPath,
        total: info.names.length,
        conflicts: folderConflicts
      });
    }

    res.json({
      total,
      conflicts,
      folders,
      parent_path: parentPath
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 将文件夹内所有内容提取到上级目录（支持 path 单条或 paths 批量；仅移动直接子项）
router.post('/lift-contents', async (req, res) => {
  try {
    const { auth_code, on_conflict = 'skip' } = req.body;
    const pathList = resolvePathList(req.body);

    if (!pathList.length) {
      return res.status(400).json({ error: '请指定文件夹' });
    }

    if (!['skip', 'overwrite'].includes(on_conflict)) {
      return res.status(400).json({ error: 'on_conflict 参数无效' });
    }

    const ftp = await findFtpByAuthCode(auth_code);
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }

    const sshService = createSshFromFtp(ftp);
    const results = [];
    let moved = 0;
    let skipped = 0;
    let overwritten = 0;
    let failed = 0;
    const errors = [];
    let parentPath = '';

    for (const folderPath of pathList) {
      const info = await inspectLiftFolder(sshService, ftp, folderPath);
      if (!info.ok) {
        if (pathList.length === 1) {
          return res.status(info.status || 400).json({ error: info.error });
        }
        failed += 1;
        errors.push(folderPath);
        results.push({
          path: folderPath,
          moved: 0,
          skipped: 0,
          overwritten: 0,
          failed: 1,
          errors: [info.error]
        });
        continue;
      }

      parentPath = info.parent_path;

      if (info.names.length === 0) {
        results.push({
          path: folderPath,
          moved: 0,
          skipped: 0,
          overwritten: 0,
          failed: 0,
          errors: [],
          empty: true
        });
        continue;
      }

      const one = await liftOneFolder(sshService, info, on_conflict);
      moved += one.moved;
      skipped += one.skipped;
      overwritten += one.overwritten;
      failed += one.failed;
      errors.push(...one.errors.map(name => `${folderPath}/${name}`));
      results.push(one);
    }

    if (pathList.length === 1 && results[0]?.empty) {
      return res.json({
        success: true,
        moved: 0,
        skipped: 0,
        overwritten: 0,
        failed: 0,
        errors: [],
        folders: results,
        parent_path: parentPath,
        message: '文件夹已是空的'
      });
    }

    const message = buildLiftMessage({
      moved,
      skipped,
      overwritten,
      failed,
      folderCount: pathList.length
    });

    res.json({
      success: failed === 0,
      moved,
      skipped,
      overwritten,
      failed,
      errors,
      folders: results,
      parent_path: parentPath,
      message
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 清空文件夹（保留文件夹本身；支持 path 单条或 paths 批量）
router.post('/empty-folder', async (req, res) => {
  try {
    const { auth_code } = req.body;
    const pathList = resolvePathList(req.body);

    if (!pathList.length) {
      return res.status(400).json({ error: '请指定文件夹' });
    }

    const ftp = await findFtpByAuthCode(auth_code);
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }

    const sshService = createSshFromFtp(ftp);
    let removed = 0;
    let failed = 0;
    const folders = [];

    for (const folderPath of pathList) {
      if (isProtectedPath(folderPath)) {
        if (pathList.length === 1) {
          return res.status(403).json({ error: '系统目录不可操作' });
        }
        failed += 1;
        folders.push({ path: folderPath, removed: 0, failed: 1, error: '系统目录不可操作' });
        continue;
      }

      const targetFolder = remoteAbs(ftp.home_dir, folderPath);
      if (!targetFolder.startsWith(ftp.home_dir) || targetFolder === ftp.home_dir) {
        if (pathList.length === 1) {
          return res.status(403).json({ error: '无权操作该目录' });
        }
        failed += 1;
        folders.push({ path: folderPath, removed: 0, failed: 1, error: '无权操作该目录' });
        continue;
      }

      const dirCheck = await sshService.exec(`test -d ${shellQuote(targetFolder)} && echo 1 || echo 0`);
      if (dirCheck.output?.trim() !== '1') {
        if (pathList.length === 1) {
          return res.status(400).json({ error: '目标不是文件夹或不存在' });
        }
        failed += 1;
        folders.push({ path: folderPath, removed: 0, failed: 1, error: '目标不是文件夹或不存在' });
        continue;
      }

      const listResult = await sshService.exec(`ls -A ${shellQuote(targetFolder)} 2>/dev/null`);
      const names = (listResult.output || '').split('\n').map(s => s.trim()).filter(Boolean)
        .filter(name => !shouldHideInList(name, folderPath));

      if (names.length === 0) {
        folders.push({ path: folderPath, removed: 0, failed: 0 });
        continue;
      }

      const targets = names.map(name => remoteAbs(targetFolder, name));
      const quoted = targets.map(p => shellQuote(p)).join(' ');
      const rmResult = await sshService.exec(`rm -rf -- ${quoted}`);
      if (rmResult.success || rmResult.code === 0) {
        removed += names.length;
        folders.push({ path: folderPath, removed: names.length, failed: 0 });
      } else {
        failed += names.length;
        folders.push({
          path: folderPath,
          removed: 0,
          failed: names.length,
          error: rmResult.output || '清空失败'
        });
      }
    }

    res.json({
      success: failed === 0,
      removed,
      failed,
      folders,
      message: failed === 0
        ? `已清空 ${removed} 项`
        : `部分失败：已清空 ${removed} 项，失败 ${failed} 项`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
