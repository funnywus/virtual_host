const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const SshFtpService = require('../services/ssh-ftp');

const router = express.Router();

// 配置 multer 用于分片上传
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 每片最大 10MB
});

// 临时目录
const TEMP_DIR = path.join(__dirname, '../temp/chunks');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// 计算域名的授权码
function getDomainAuthCode(domain) {
  return crypto.createHash('md5').update(domain).digest('hex').toLowerCase();
}

// 根据授权码查找FTP账号
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

// 初始化分片上传
router.post('/init-chunk', async (req, res) => {
  try {
    const { auth_code, path: dirPath, filename, total_chunks, file_size } = req.body;
    
    const ftp = await findFtpByAuthCode(auth_code);
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }
    
    // 生成上传 ID
    const uploadId = crypto.randomBytes(16).toString('hex');
    
    // 创建临时目录
    const chunkDir = path.join(TEMP_DIR, uploadId);
    fs.mkdirSync(chunkDir, { recursive: true });
    
    // 保存上传信息
    const uploadInfo = {
      uploadId,
      auth_code,
      dirPath,
      filename,
      total_chunks: parseInt(total_chunks),
      file_size: parseInt(file_size),
      uploaded_chunks: [],
      ftp_info: {
        ip: ftp.ip,
        port: ftp.ssh_port,
        username: ftp.ssh_user,
        password: ftp.ssh_pass,
        home_dir: ftp.home_dir
      },
      created_at: Date.now()
    };
    
    fs.writeFileSync(
      path.join(chunkDir, 'info.json'),
      JSON.stringify(uploadInfo)
    );
    
    res.json({ uploadId, message: '初始化成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 上传分片
router.post('/upload-chunk', upload.single('chunk'), async (req, res) => {
  try {
    const { uploadId, chunk_index } = req.body;
    const chunk = req.file;
    
    if (!chunk) {
      return res.status(400).json({ error: '未找到分片数据' });
    }
    
    const chunkDir = path.join(TEMP_DIR, uploadId);
    const infoPath = path.join(chunkDir, 'info.json');
    
    if (!fs.existsSync(infoPath)) {
      return res.status(404).json({ error: '上传会话不存在' });
    }
    
    // 读取上传信息
    const uploadInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    
    // 保存分片
    const chunkPath = path.join(chunkDir, `chunk_${chunk_index}`);
    fs.writeFileSync(chunkPath, chunk.buffer);
    
    // 更新已上传分片列表
    if (!uploadInfo.uploaded_chunks.includes(parseInt(chunk_index))) {
      uploadInfo.uploaded_chunks.push(parseInt(chunk_index));
      fs.writeFileSync(infoPath, JSON.stringify(uploadInfo));
    }
    
    res.json({ 
      success: true, 
      uploaded: uploadInfo.uploaded_chunks.length,
      total: uploadInfo.total_chunks
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 合并分片并上传到远程服务器
router.post('/merge-chunks', async (req, res) => {
  try {
    const { uploadId } = req.body;
    
    const chunkDir = path.join(TEMP_DIR, uploadId);
    const infoPath = path.join(chunkDir, 'info.json');
    
    if (!fs.existsSync(infoPath)) {
      return res.status(404).json({ error: '上传会话不存在' });
    }
    
    const uploadInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    
    // 检查是否所有分片都已上传
    if (uploadInfo.uploaded_chunks.length !== uploadInfo.total_chunks) {
      return res.status(400).json({ 
        error: '分片不完整',
        uploaded: uploadInfo.uploaded_chunks.length,
        total: uploadInfo.total_chunks
      });
    }
    
    // 合并分片
    const mergedPath = path.join(chunkDir, 'merged');
    const writeStream = fs.createWriteStream(mergedPath);
    
    for (let i = 0; i < uploadInfo.total_chunks; i++) {
      const chunkPath = path.join(chunkDir, `chunk_${i}`);
      const chunkData = fs.readFileSync(chunkPath);
      writeStream.write(chunkData);
    }
    
    writeStream.end();
    
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
    
    // 上传到远程服务器
    const sshService = new SshFtpService({
      ip: uploadInfo.ftp_info.ip,
      port: uploadInfo.ftp_info.port,
      username: uploadInfo.ftp_info.username,
      password: uploadInfo.ftp_info.password
    });
    
    const targetDir = uploadInfo.dirPath 
      ? path.join(uploadInfo.ftp_info.home_dir, uploadInfo.dirPath)
      : uploadInfo.ftp_info.home_dir;
    
    const targetFile = path.join(targetDir, uploadInfo.filename);
    
    // 创建目录
    await sshService.exec(`mkdir -p "${targetDir}"`);
    
    // 读取合并后的文件并上传
    const fileBuffer = fs.readFileSync(mergedPath);
    await sshService.uploadFile(fileBuffer, targetFile);
    
    // 设置权限
    await sshService.exec(`chmod 644 "${targetFile}"`);
    await sshService.exec(`chown www:www "${targetFile}" 2>/dev/null || chown www-data:www-data "${targetFile}"`);
    
    // 清理临时文件
    fs.rmSync(chunkDir, { recursive: true, force: true });
    
    res.json({ success: true, message: '上传成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 取消上传
router.post('/cancel-upload', async (req, res) => {
  try {
    const { uploadId } = req.body;
    const chunkDir = path.join(TEMP_DIR, uploadId);
    
    if (fs.existsSync(chunkDir)) {
      fs.rmSync(chunkDir, { recursive: true, force: true });
    }
    
    res.json({ success: true, message: '已取消上传' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 清理过期的临时文件（超过 24 小时）
function cleanupExpiredUploads() {
  try {
    if (!fs.existsSync(TEMP_DIR)) return;
    
    const uploads = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 小时
    
    uploads.forEach(uploadId => {
      const chunkDir = path.join(TEMP_DIR, uploadId);
      const infoPath = path.join(chunkDir, 'info.json');
      
      if (fs.existsSync(infoPath)) {
        const uploadInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
        if (now - uploadInfo.created_at > maxAge) {
          fs.rmSync(chunkDir, { recursive: true, force: true });
          console.log(`清理过期上传: ${uploadId}`);
        }
      }
    });
  } catch (err) {
    console.error('清理临时文件失败:', err);
  }
}

// 每小时清理一次
setInterval(cleanupExpiredUploads, 60 * 60 * 1000);

module.exports = router;
