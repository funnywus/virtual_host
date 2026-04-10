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

// 检查磁盘空间（返回可用空间，单位：字节）
function getAvailableDiskSpace() {
  try {
    const { execSync } = require('child_process');
    // Mac/Linux
    const output = execSync(`df -k "${TEMP_DIR}" | tail -1 | awk '{print $4}'`).toString().trim();
    return parseInt(output) * 1024; // 转换为字节
  } catch (err) {
    console.error('获取磁盘空间失败:', err.message);
    return null;
  }
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
    
    console.log(`[初始化上传] filename: ${filename}, total_chunks: ${total_chunks}, file_size: ${file_size}`);
    
    const ftp = await findFtpByAuthCode(auth_code);
    if (!ftp || !ftp.ip) {
      console.error('[初始化上传] 错误: 授权码无效或服务器未配置');
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }
    
    // 生成上传 ID
    const uploadId = crypto.randomBytes(16).toString('hex');
    console.log(`[初始化上传] 生成 uploadId: ${uploadId}`);
    
    // 创建临时目录
    const chunkDir = path.join(TEMP_DIR, uploadId);
    try {
      fs.mkdirSync(chunkDir, { recursive: true });
      console.log(`[初始化上传] 创建临时目录: ${chunkDir}`);
    } catch (err) {
      console.error(`[初始化上传] 错误: 创建临时目录失败 - ${err.message}`);
      return res.status(500).json({ error: '创建临时目录失败: ' + err.message });
    }
    
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
    
    try {
      fs.writeFileSync(
        path.join(chunkDir, 'info.json'),
        JSON.stringify(uploadInfo)
      );
      console.log(`[初始化上传] 保存上传信息成功`);
    } catch (err) {
      console.error(`[初始化上传] 错误: 保存上传信息失败 - ${err.message}`);
      return res.status(500).json({ error: '保存上传信息失败: ' + err.message });
    }
    
    res.json({ uploadId, message: '初始化成功' });
  } catch (err) {
    console.error(`[初始化上传] 未捕获错误: ${err.message}`, err.stack);
    res.status(500).json({ error: '初始化失败: ' + err.message });
  }
});

// 上传分片
router.post('/upload-chunk', upload.single('chunk'), async (req, res) => {
  try {
    const { uploadId, chunk_index } = req.body;
    const chunk = req.file;
    
    console.log(`[分片上传] uploadId: ${uploadId}, chunk_index: ${chunk_index}, size: ${chunk?.size || 0}`);
    
    if (!chunk) {
      console.error('[分片上传] 错误: 未找到分片数据');
      return res.status(400).json({ error: '未找到分片数据' });
    }
    
    // 检查磁盘空间
    const availableSpace = getAvailableDiskSpace();
    if (availableSpace !== null && chunk.size > availableSpace) {
      console.error(`[分片上传] 错误: 磁盘空间不足 - 需要 ${chunk.size} 字节，可用 ${availableSpace} 字节`);
      return res.status(507).json({ error: `服务器磁盘空间不足，请联系管理员` });
    }
    
    const chunkDir = path.join(TEMP_DIR, uploadId);
    const infoPath = path.join(chunkDir, 'info.json');
    
    if (!fs.existsSync(infoPath)) {
      console.error(`[分片上传] 错误: 上传会话不存在 - ${uploadId}`);
      return res.status(404).json({ error: '上传会话不存在，请重新开始上传' });
    }
    
    // 读取上传信息
    let uploadInfo;
    try {
      uploadInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    } catch (err) {
      console.error(`[分片上传] 错误: 读取上传信息失败 - ${err.message}`);
      return res.status(500).json({ error: '读取上传信息失败: ' + err.message });
    }
    
    // 保存分片
    const chunkPath = path.join(chunkDir, `chunk_${chunk_index}`);
    try {
      fs.writeFileSync(chunkPath, chunk.buffer);
      console.log(`[分片上传] 分片 ${chunk_index} 保存成功`);
    } catch (err) {
      console.error(`[分片上传] 错误: 保存分片失败 - ${err.message}`);
      return res.status(500).json({ error: '保存分片失败: ' + err.message });
    }
    
    // 更新已上传分片列表
    if (!uploadInfo.uploaded_chunks.includes(parseInt(chunk_index))) {
      uploadInfo.uploaded_chunks.push(parseInt(chunk_index));
      try {
        fs.writeFileSync(infoPath, JSON.stringify(uploadInfo));
      } catch (err) {
        console.error(`[分片上传] 错误: 更新上传信息失败 - ${err.message}`);
        return res.status(500).json({ error: '更新上传信息失败: ' + err.message });
      }
    }
    
    res.json({ 
      success: true, 
      uploaded: uploadInfo.uploaded_chunks.length,
      total: uploadInfo.total_chunks
    });
  } catch (err) {
    console.error(`[分片上传] 未捕获错误: ${err.message}`, err.stack);
    res.status(500).json({ error: '分片上传失败: ' + err.message });
  }
});

// 合并分片并上传到远程服务器
router.post('/merge-chunks', async (req, res) => {
  let chunkDir, uploadInfo;
  
  try {
    const { uploadId } = req.body;
    
    console.log(`[合并分片] 开始合并 uploadId: ${uploadId}`);
    
    chunkDir = path.join(TEMP_DIR, uploadId);
    const infoPath = path.join(chunkDir, 'info.json');
    
    if (!fs.existsSync(infoPath)) {
      console.error(`[合并分片] 错误: 上传会话不存在 - ${uploadId}`);
      return res.status(404).json({ error: '上传会话不存在' });
    }
    
    uploadInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
    console.log(`[合并分片] 文件: ${uploadInfo.filename}, 总分片: ${uploadInfo.total_chunks}`);
    
    // 检查是否所有分片都已上传
    if (uploadInfo.uploaded_chunks.length !== uploadInfo.total_chunks) {
      console.error(`[合并分片] 错误: 分片不完整 ${uploadInfo.uploaded_chunks.length}/${uploadInfo.total_chunks}`);
      return res.status(400).json({ 
        error: '分片不完整',
        uploaded: uploadInfo.uploaded_chunks.length,
        total: uploadInfo.total_chunks
      });
    }
    
    // 使用流式合并，避免内存溢出
    const mergedPath = path.join(chunkDir, 'merged');
    console.log(`[合并分片] 开始流式合并到: ${mergedPath}`);
    
    await new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(mergedPath);
      let currentChunk = 0;
      
      const writeNextChunk = () => {
        if (currentChunk >= uploadInfo.total_chunks) {
          writeStream.end();
          return;
        }
        
        const chunkPath = path.join(chunkDir, `chunk_${currentChunk}`);
        
        if (!fs.existsSync(chunkPath)) {
          reject(new Error(`分片 ${currentChunk} 不存在`));
          return;
        }
        
        // 使用流式读取，避免一次性加载到内存
        const readStream = fs.createReadStream(chunkPath);
        
        readStream.on('data', (chunk) => {
          if (!writeStream.write(chunk)) {
            readStream.pause();
          }
        });
        
        readStream.on('end', () => {
          currentChunk++;
          console.log(`[合并分片] 已合并 ${currentChunk}/${uploadInfo.total_chunks} 分片`);
          writeNextChunk();
        });
        
        readStream.on('error', (err) => {
          reject(new Error(`读取分片 ${currentChunk} 失败: ${err.message}`));
        });
        
        writeStream.on('drain', () => {
          readStream.resume();
        });
      };
      
      writeStream.on('finish', () => {
        console.log(`[合并分片] 合并完成`);
        resolve();
      });
      
      writeStream.on('error', (err) => {
        reject(new Error(`写入合并文件失败: ${err.message}`));
      });
      
      writeNextChunk();
    });
    
    console.log(`[合并分片] 开始上传到远程服务器`);
    
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
    
    // 使用流式上传，避免内存溢出
    console.log(`[合并分片] 开始流式上传到远程服务器`);
    
    // 获取文件大小
    const fileStats = fs.statSync(mergedPath);
    console.log(`[合并分片] 文件大小: ${(fileStats.size / 1024 / 1024).toFixed(2)}MB`);
    
    // 使用流式上传
    await sshService.uploadFileStream(mergedPath, targetFile);
    console.log(`[合并分片] 上传完成`);
    
    // 设置权限
    await sshService.exec(`chmod 644 "${targetFile}"`);
    await sshService.exec(`chown www:www "${targetFile}" 2>/dev/null || chown www-data:www-data "${targetFile}" 2>/dev/null`);
    
    // 清理临时文件
    console.log(`[合并分片] 清理临时文件`);
    fs.rmSync(chunkDir, { recursive: true, force: true });
    
    console.log(`[合并分片] 完成`);
    res.json({ success: true, message: '上传成功' });
  } catch (err) {
    console.error(`[合并分片] 错误: ${err.message}`, err.stack);
    
    // 清理临时文件
    if (chunkDir && fs.existsSync(chunkDir)) {
      try {
        fs.rmSync(chunkDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.error(`[合并分片] 清理失败: ${cleanupErr.message}`);
      }
    }
    
    res.status(500).json({ error: '合并上传失败: ' + err.message });
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
