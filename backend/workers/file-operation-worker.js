const { parentPort, workerData } = require('worker_threads');
const SshFtpService = require('../services/ssh-ftp');
const path = require('path');

async function processFileOperation() {
  try {
    const { operation, config, params } = workerData;
    
    const sshService = new SshFtpService(config);
    
    let result;
    
    switch (operation) {
      case 'extract':
        result = await handleExtract(sshService, params);
        break;
      case 'compress':
        result = await handleCompress(sshService, params);
        break;
      case 'copy':
        result = await handleCopy(sshService, params);
        break;
      case 'delete':
        result = await handleDelete(sshService, params);
        break;
      default:
        throw new Error(`Unknown operation: ${operation}`);
    }
    
    parentPort.postMessage({ success: true, result });
  } catch (error) {
    parentPort.postMessage({ success: false, error: error.message });
  }
}

async function handleExtract(sshService, params) {
  const { targetFile, extractDir } = params;
  const ext = path.extname(targetFile).toLowerCase();
  
  let result;
  
  if (ext === '.zip') {
    result = await sshService.exec(`cd "${extractDir}" && unzip -o "${targetFile}"`);
  } else if (ext === '.gz' || ext === '.tgz') {
    result = await sshService.exec(`cd "${extractDir}" && tar -xzf "${targetFile}"`);
  } else if (ext === '.tar') {
    result = await sshService.exec(`cd "${extractDir}" && tar -xf "${targetFile}"`);
  } else if (ext === '.7z') {
    result = await sshService.exec(`cd "${extractDir}" && 7z x "${targetFile}" -y`);
  } else {
    throw new Error('不支持的压缩格式');
  }
  
  if (result.success || result.code === 0) {
    // 设置权限
    await sshService.exec(`chmod -R 755 "${extractDir}"`);
    await sshService.exec(`find "${extractDir}" -type f -exec chmod 644 {} \\;`);
    await sshService.exec(`chown -R www:www "${extractDir}" 2>/dev/null || chown -R www "${extractDir}" 2>/dev/null`);
    return { message: '解压成功' };
  } else {
    throw new Error('解压失败: ' + (result.error || '未知错误'));
  }
}

async function handleCompress(sshService, params) {
  const { homeDir, paths, archiveName, format } = params;
  const fileList = paths.map(p => `"${p}"`).join(' ');
  
  let result;
  
  if (format === 'zip') {
    result = await sshService.exec(`cd "${homeDir}" && zip -r "${archiveName}" ${fileList}`);
  } else if (format === 'tar.gz') {
    result = await sshService.exec(`cd "${homeDir}" && tar -czf "${archiveName}" ${fileList}`);
  } else {
    throw new Error('不支持的压缩格式');
  }
  
  if (result.success || result.code === 0) {
    return { message: '压缩成功', archive: archiveName };
  } else {
    throw new Error('压缩失败');
  }
}

async function handleCopy(sshService, params) {
  const { sourcePath, targetPath } = params;
  
  const result = await sshService.exec(`cp -r "${sourcePath}" "${targetPath}"`);
  
  if (result.success || result.code === 0) {
    // 设置权限
    await sshService.exec(`chmod -R 755 "${targetPath}"`);
    await sshService.exec(`find "${targetPath}" -type f -exec chmod 644 {} \\;`);
    await sshService.exec(`chown -R www:www "${targetPath}" 2>/dev/null || chown -R www "${targetPath}" 2>/dev/null`);
    return { message: '复制成功' };
  } else {
    throw new Error('复制失败: ' + (result.output || '未知错误'));
  }
}

async function handleDelete(sshService, params) {
  const { targetPath } = params;
  
  const result = await sshService.exec(`rm -rf "${targetPath}"`);
  
  if (result.success || result.code === 0) {
    return { message: '删除成功' };
  } else {
    throw new Error('删除失败');
  }
}

processFileOperation();
