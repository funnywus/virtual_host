#!/usr/bin/env node

/**
 * 清理临时文件脚本
 */

const fs = require('fs');
const path = require('path');

const TEMP_DIR = path.join(__dirname, '../temp/chunks');

console.log('开始清理临时文件...');
console.log(`目录: ${TEMP_DIR}`);

if (!fs.existsSync(TEMP_DIR)) {
  console.log('临时目录不存在，无需清理');
  process.exit(0);
}

try {
  const uploads = fs.readdirSync(TEMP_DIR);
  console.log(`找到 ${uploads.length} 个上传会话`);
  
  let cleaned = 0;
  uploads.forEach(uploadId => {
    const chunkDir = path.join(TEMP_DIR, uploadId);
    try {
      fs.rmSync(chunkDir, { recursive: true, force: true });
      cleaned++;
      console.log(`✅ 已清理: ${uploadId.substring(0, 8)}...`);
    } catch (err) {
      console.log(`❌ 清理失败: ${uploadId.substring(0, 8)}... - ${err.message}`);
    }
  });
  
  console.log(`\n清理完成: ${cleaned}/${uploads.length} 个会话`);
} catch (err) {
  console.error('清理失败:', err.message);
  process.exit(1);
}
