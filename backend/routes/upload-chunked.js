const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const SshFtpService = require('../services/ssh-ftp');
const { findFtpByAuthCode, isPathInsideHome } = require('../services/ftp-lookup');
const { normalizeRelPath } = require('../services/upload-system-files');
const { getUploadSignSecret } = require('../utils/env-check');

const router = express.Router();

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** 清理远程文件名：去掉路径穿越与控制字符，保留中文等 Unicode */
function sanitizeRemoteFilename(name) {
  let base = String(name || '').replace(/\\/g, '/');
  base = path.posix.basename(base);
  base = base.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (!base || base === '.' || base === '..') {
    base = `file_${Date.now()}`;
  }
  return base;
}

function hashAuthCode(authCode) {
  const code = String(authCode || '').trim().toLowerCase();
  return crypto.createHmac('sha256', getUploadSignSecret()).update(code).digest('hex');
}

function safeUploadId(uploadId) {
  const id = String(uploadId || '');
  if (!/^[a-f0-9]{16,64}$/i.test(id)) return null;
  return id;
}

function loadUploadInfo(chunkDir) {
  const infoPath = path.join(chunkDir, 'info.json');
  if (!fs.existsSync(infoPath)) return null;
  const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  // 兼容清理：旧会话若仍含明文密码则擦除后回写
  if (info.ftp_info && (info.ftp_info.password || info.ftp_info.username)) {
    delete info.ftp_info.password;
    delete info.ftp_info.username;
    delete info.ftp_info.ip;
    delete info.ftp_info.port;
    try {
      fs.writeFileSync(infoPath, JSON.stringify(info));
    } catch { /* ignore */ }
  }
  if (info.auth_code) {
    if (!info.auth_code_hash) {
      info.auth_code_hash = hashAuthCode(info.auth_code);
    }
    delete info.auth_code;
    try {
      fs.writeFileSync(infoPath, JSON.stringify(info));
    } catch { /* ignore */ }
  }
  return info;
}

function assertSessionAuth(uploadInfo, authCode) {
  const code = String(authCode || '').trim().toLowerCase();
  if (!code) {
    const err = new Error('缺少授权码');
    err.status = 401;
    throw err;
  }
  if (!uploadInfo?.auth_code_hash || hashAuthCode(code) !== uploadInfo.auth_code_hash) {
    const err = new Error('授权码与上传会话不匹配');
    err.status = 401;
    throw err;
  }
  return code;
}

// 分片上传相关接口取消超时限制（大文件合并 + SFTP 上传可能耗时很久）
router.use((req, res, next) => {
  req.setTimeout(0);
  res.setTimeout(0);
  next();
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const TEMP_DIR = path.join(__dirname, '../temp/chunks');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

const mergeTasks = new Map();
const MERGE_TASK_TTL = 30 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [taskId, task] of mergeTasks.entries()) {
    if (task.finished_at && now - task.finished_at > MERGE_TASK_TTL) {
      mergeTasks.delete(taskId);
    }
  }
}, 5 * 60 * 1000);

function getAvailableDiskSpace() {
  try {
    const { execSync } = require('child_process');
    const output = execSync(`df -k "${TEMP_DIR}" | tail -1 | awk '{print $4}'`).toString().trim();
    return parseInt(output) * 1024;
  } catch (err) {
    console.error('获取磁盘空间失败:', err.message);
    return null;
  }
}

router.post('/init-chunk', async (req, res) => {
  try {
    const { auth_code, path: dirPathRaw, filename, total_chunks, file_size } = req.body;
    const safeFilename = sanitizeRemoteFilename(filename);

    console.log(`[初始化上传] filename: ${safeFilename}, total_chunks: ${total_chunks}, file_size: ${file_size}`);

    const ftp = await findFtpByAuthCode(auth_code);
    if (!ftp || !ftp.ip) {
      return res.status(401).json({ error: '授权码无效或服务器未配置' });
    }

    const dirPath = normalizeRelPath(dirPathRaw || '');
    if (dirPath === null) {
      return res.status(400).json({ error: '非法路径' });
    }

    const uploadId = crypto.randomBytes(16).toString('hex');
    const chunkDir = path.join(TEMP_DIR, uploadId);
    fs.mkdirSync(chunkDir, { recursive: true });

    // 磁盘仅存会话绑定信息，不存 SSH 明文密码
    const uploadInfo = {
      uploadId,
      auth_code_hash: hashAuthCode(auth_code),
      ftp_id: ftp.id,
      home_dir: ftp.home_dir,
      dirPath,
      filename: safeFilename,
      total_chunks: parseInt(total_chunks, 10),
      file_size: parseInt(file_size, 10),
      uploaded_chunks: [],
      created_at: Date.now()
    };

    fs.writeFileSync(path.join(chunkDir, 'info.json'), JSON.stringify(uploadInfo));
    res.json({ uploadId, message: '初始化成功' });
  } catch (err) {
    console.error(`[初始化上传] 未捕获错误: ${err.message}`, err.stack);
    res.status(500).json({ error: '初始化失败: ' + err.message });
  }
});

router.post('/upload-chunk', upload.single('chunk'), async (req, res) => {
  try {
    const { uploadId: rawId, chunk_index, auth_code } = req.body;
    const chunk = req.file;
    const uploadId = safeUploadId(rawId);

    if (!uploadId) {
      return res.status(400).json({ error: '无效的上传会话' });
    }
    if (!chunk) {
      return res.status(400).json({ error: '未找到分片数据' });
    }

    const availableSpace = getAvailableDiskSpace();
    if (availableSpace !== null && chunk.size > availableSpace) {
      return res.status(507).json({ error: '服务器磁盘空间不足，请联系管理员' });
    }

    const chunkDir = path.join(TEMP_DIR, uploadId);
    const uploadInfo = loadUploadInfo(chunkDir);
    if (!uploadInfo) {
      return res.status(404).json({ error: '上传会话不存在，请重新开始上传' });
    }

    try {
      assertSessionAuth(uploadInfo, auth_code);
    } catch (authErr) {
      return res.status(authErr.status || 401).json({ error: authErr.message });
    }

    const chunkPath = path.join(chunkDir, `chunk_${chunk_index}`);
    fs.writeFileSync(chunkPath, chunk.buffer);

    if (!uploadInfo.uploaded_chunks.includes(parseInt(chunk_index, 10))) {
      uploadInfo.uploaded_chunks.push(parseInt(chunk_index, 10));
      fs.writeFileSync(path.join(chunkDir, 'info.json'), JSON.stringify(uploadInfo));
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

router.post('/merge-chunks', async (req, res) => {
  try {
    const { uploadId: rawId, auth_code } = req.body;
    const uploadId = safeUploadId(rawId);
    if (!uploadId) {
      return res.status(400).json({ error: '无效的上传会话' });
    }

    const chunkDir = path.join(TEMP_DIR, uploadId);
    const uploadInfo = loadUploadInfo(chunkDir);
    if (!uploadInfo) {
      return res.status(404).json({ error: '上传会话不存在' });
    }

    let code;
    try {
      code = assertSessionAuth(uploadInfo, auth_code);
    } catch (authErr) {
      return res.status(authErr.status || 401).json({ error: authErr.message });
    }

    if (uploadInfo.uploaded_chunks.length !== uploadInfo.total_chunks) {
      return res.status(400).json({
        error: '分片不完整',
        uploaded: uploadInfo.uploaded_chunks.length,
        total: uploadInfo.total_chunks
      });
    }

    const ftp = await findFtpByAuthCode(code);
    if (!ftp || !ftp.ip || ftp.id !== uploadInfo.ftp_id) {
      return res.status(401).json({ error: '授权码无效或会话已失效' });
    }

    const taskId = crypto.randomBytes(16).toString('hex');
    mergeTasks.set(taskId, {
      taskId,
      uploadId,
      auth_code_hash: uploadInfo.auth_code_hash,
      filename: uploadInfo.filename,
      status: 'merging',
      phase: '合并分片中',
      progress: 0,
      total_size: uploadInfo.file_size || 0,
      uploaded_bytes: 0,
      error: null,
      created_at: Date.now(),
      finished_at: null
    });

    res.json({ success: true, taskId, message: '已开始后台合并上传' });

    processMergeAndUpload(taskId, chunkDir, uploadInfo, ftp).catch(err => {
      console.error(`[合并分片] 后台任务异常: ${err.message}`, err.stack);
      const task = mergeTasks.get(taskId);
      if (task) {
        task.status = 'error';
        task.error = err.message;
        task.finished_at = Date.now();
      }
      try {
        if (fs.existsSync(chunkDir)) fs.rmSync(chunkDir, { recursive: true, force: true });
      } catch { /* ignore */ }
    });
  } catch (err) {
    console.error(`[合并分片] 错误: ${err.message}`, err.stack);
    res.status(500).json({ error: '合并上传失败: ' + err.message });
  }
});

router.get('/merge-status/:taskId', (req, res) => {
  const task = mergeTasks.get(req.params.taskId);
  if (!task) {
    return res.status(404).json({ error: '任务不存在或已过期' });
  }
  // 可选：带 auth_code 时校验会话绑定
  const authCode = req.query.auth_code || req.headers['x-auth-code'];
  if (authCode) {
    try {
      if (hashAuthCode(authCode) !== task.auth_code_hash) {
        return res.status(401).json({ error: '授权码与任务不匹配' });
      }
    } catch {
      return res.status(401).json({ error: '授权校验失败' });
    }
  }
  res.json({
    taskId: task.taskId,
    status: task.status,
    phase: task.phase,
    progress: task.progress,
    total_size: task.total_size,
    uploaded_bytes: task.uploaded_bytes,
    error: task.error,
    filename: task.filename
  });
});

async function processMergeAndUpload(taskId, chunkDir, uploadInfo, ftp) {
  const task = mergeTasks.get(taskId);
  console.log(`[合并分片] 后台开始 taskId: ${taskId}, 文件: ${uploadInfo.filename}`);

  const mergedPath = path.join(chunkDir, 'merged');
  task.status = 'merging';
  task.phase = '合并分片中';

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

      const readStream = fs.createReadStream(chunkPath);
      readStream.on('data', (chunk) => {
        if (!writeStream.write(chunk)) {
          readStream.pause();
        }
      });
      readStream.on('end', () => {
        currentChunk++;
        task.progress = Math.round((currentChunk / uploadInfo.total_chunks) * 50);
        writeNextChunk();
      });
      readStream.on('error', (err) => {
        reject(new Error(`读取分片 ${currentChunk} 失败: ${err.message}`));
      });
      writeStream.on('drain', () => {
        readStream.resume();
      });
    };

    writeStream.on('finish', resolve);
    writeStream.on('error', (err) => {
      reject(new Error(`写入合并文件失败: ${err.message}`));
    });

    writeNextChunk();
  });

  task.status = 'uploading';
  task.phase = '上传到服务器中';

  const sshService = new SshFtpService({
    ip: ftp.ip,
    port: ftp.ssh_port,
    username: ftp.ssh_user,
    password: ftp.ssh_pass
  });

  const homeDir = ftp.home_dir || uploadInfo.home_dir;
  const relDir = normalizeRelPath(uploadInfo.dirPath || '');
  if (relDir === null) {
    throw new Error('非法目标路径');
  }
  const targetDir = relDir ? path.posix.join(homeDir, relDir) : homeDir;
  const targetFile = path.posix.join(targetDir, sanitizeRemoteFilename(uploadInfo.filename));

  if (!isPathInsideHome(targetDir, homeDir) || !isPathInsideHome(targetFile, homeDir)) {
    throw new Error('无权写入该路径');
  }

  await sshService.exec(`mkdir -p -- ${shellQuote(targetDir)}`);

  const fileStats = fs.statSync(mergedPath);
  const totalSize = fileStats.size;
  task.total_size = totalSize;

  await sshService.uploadFileStream(mergedPath, targetFile, (bytesWritten) => {
    task.uploaded_bytes = bytesWritten;
    if (totalSize > 0) {
      task.progress = 50 + Math.min(50, Math.round((bytesWritten / totalSize) * 50));
    }
  });

  await sshService.exec(`chmod 644 -- ${shellQuote(targetFile)}`);
  await sshService.exec(
    `chown www:www -- ${shellQuote(targetFile)} 2>/dev/null || chown www-data:www-data -- ${shellQuote(targetFile)} 2>/dev/null`
  );

  fs.rmSync(chunkDir, { recursive: true, force: true });

  task.status = 'completed';
  task.phase = '完成';
  task.progress = 100;
  task.finished_at = Date.now();
  console.log(`[合并分片] 任务完成 taskId: ${taskId}`);
}

router.post('/cancel-upload', async (req, res) => {
  try {
    const { uploadId: rawId, auth_code } = req.body;
    const uploadId = safeUploadId(rawId);
    if (!uploadId) {
      return res.status(400).json({ error: '无效的上传会话' });
    }

    const chunkDir = path.join(TEMP_DIR, uploadId);
    const uploadInfo = loadUploadInfo(chunkDir);
    if (uploadInfo) {
      try {
        assertSessionAuth(uploadInfo, auth_code);
      } catch (authErr) {
        return res.status(authErr.status || 401).json({ error: authErr.message });
      }
    }

    if (fs.existsSync(chunkDir)) {
      fs.rmSync(chunkDir, { recursive: true, force: true });
    }

    res.json({ success: true, message: '已取消上传' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function cleanupExpiredUploads() {
  try {
    if (!fs.existsSync(TEMP_DIR)) return;

    const uploads = fs.readdirSync(TEMP_DIR);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;

    uploads.forEach((uploadId) => {
      const chunkDir = path.join(TEMP_DIR, uploadId);
      const infoPath = path.join(chunkDir, 'info.json');

      if (fs.existsSync(infoPath)) {
        try {
          const uploadInfo = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
          if (now - uploadInfo.created_at > maxAge) {
            fs.rmSync(chunkDir, { recursive: true, force: true });
            console.log(`清理过期上传: ${uploadId}`);
          }
        } catch {
          /* ignore broken session */
        }
      }
    });
  } catch (err) {
    console.error('清理临时文件失败:', err);
  }
}

setInterval(cleanupExpiredUploads, 60 * 60 * 1000);

module.exports = router;
