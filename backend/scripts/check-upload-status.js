#!/usr/bin/env node

/**
 * 上传状态检查脚本
 * 用于诊断上传失败的原因
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('='.repeat(60));
console.log('上传状态检查');
console.log('='.repeat(60));

// 1. 检查临时目录
const TEMP_DIR = path.join(__dirname, '../temp/chunks');
console.log('\n1. 临时目录检查:');
console.log(`   路径: ${TEMP_DIR}`);

if (fs.existsSync(TEMP_DIR)) {
  console.log('   ✅ 目录存在');
  
  // 检查权限
  try {
    fs.accessSync(TEMP_DIR, fs.constants.R_OK | fs.constants.W_OK);
    console.log('   ✅ 可读写');
  } catch (err) {
    console.log('   ❌ 权限不足:', err.message);
  }
  
  // 检查已有的上传会话
  try {
    const uploads = fs.readdirSync(TEMP_DIR);
    console.log(`   📁 当前上传会话数: ${uploads.length}`);
    
    if (uploads.length > 0) {
      console.log('\n   活跃的上传会话:');
      uploads.forEach(uploadId => {
        const chunkDir = path.join(TEMP_DIR, uploadId);
        const infoPath = path.join(chunkDir, 'info.json');
        
        if (fs.existsSync(infoPath)) {
          const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
          const age = Math.round((Date.now() - info.created_at) / 1000 / 60);
          console.log(`   - ${uploadId.substring(0, 8)}... (${info.filename}, ${age}分钟前)`);
          console.log(`     进度: ${info.uploaded_chunks.length}/${info.total_chunks} 分片`);
        }
      });
    }
  } catch (err) {
    console.log('   ❌ 读取目录失败:', err.message);
  }
} else {
  console.log('   ❌ 目录不存在');
}

// 2. 检查磁盘空间
console.log('\n2. 磁盘空间检查:');
try {
  const output = execSync(`df -h "${TEMP_DIR}" | tail -1`).toString().trim();
  const parts = output.split(/\s+/);
  console.log(`   总空间: ${parts[1]}`);
  console.log(`   已使用: ${parts[2]} (${parts[4]})`);
  console.log(`   可用空间: ${parts[3]}`);
  
  const availableKB = parseInt(execSync(`df -k "${TEMP_DIR}" | tail -1 | awk '{print $4}'`).toString().trim());
  const availableMB = Math.round(availableKB / 1024);
  const availableGB = (availableKB / 1024 / 1024).toFixed(2);
  
  if (availableMB < 100) {
    console.log(`   ⚠️  警告: 可用空间不足 100MB (${availableMB}MB)`);
  } else if (availableMB < 1024) {
    console.log(`   ✅ 可用空间充足 (${availableMB}MB)`);
  } else {
    console.log(`   ✅ 可用空间充足 (${availableGB}GB)`);
  }
} catch (err) {
  console.log('   ❌ 检查失败:', err.message);
}

// 3. 检查 Node.js 内存
console.log('\n3. Node.js 内存使用:');
const memUsage = process.memoryUsage();
console.log(`   RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB`);
console.log(`   Heap 已用: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
console.log(`   Heap 总计: ${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);

// 4. 检查后端服务
console.log('\n4. 后端服务检查:');
try {
  const output = execSync('lsof -i :6002 2>/dev/null || echo "未运行"').toString().trim();
  if (output.includes('未运行')) {
    console.log('   ❌ 后端服务未运行');
  } else {
    console.log('   ✅ 后端服务正在运行');
    const lines = output.split('\n');
    if (lines.length > 1) {
      const parts = lines[1].split(/\s+/);
      console.log(`   PID: ${parts[1]}`);
    }
  }
} catch (err) {
  console.log('   ❌ 检查失败:', err.message);
}

// 5. 检查最近的错误日志
console.log('\n5. 最近的上传错误:');
console.log('   (查看后端控制台输出)');

console.log('\n' + '='.repeat(60));
console.log('检查完成');
console.log('='.repeat(60));

// 6. 清理建议
console.log('\n💡 清理建议:');
console.log('   清理临时文件: node scripts/cleanup-temp.js');
console.log('   重启后端服务: npm run dev');
console.log('   查看详细日志: 查看后端控制台输出');
