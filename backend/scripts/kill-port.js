#!/usr/bin/env node

/**
 * 关闭当前项目占用的端口（默认读取 backend/.env 的 PORT）
 * 用法:
 *   node scripts/kill-port.js
 *   node scripts/kill-port.js 6002
 *   npm run kill-port
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function readDefaultPort() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const match = fs.readFileSync(envPath, 'utf8').match(/^PORT\s*=\s*(\d+)/m);
    if (match) return match[1];
  }
  return process.env.PORT || '3000';
}

function listListenPids(port) {
  try {
    const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return [...new Set(out.split(/\s+/).filter(Boolean))];
  } catch {
    return [];
  }
}

const port = String(process.argv[2] || readDefaultPort()).trim();
if (!/^\d+$/.test(port)) {
  console.error(`无效端口: ${port}`);
  process.exit(1);
}

console.log(`查找占用端口 ${port} 的进程...`);
const pids = listListenPids(port);

if (pids.length === 0) {
  console.log(`端口 ${port} 未被占用`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    process.kill(Number(pid), 'SIGTERM');
    console.log(`已发送 SIGTERM: PID ${pid}`);
  } catch (err) {
    console.error(`无法终止 PID ${pid}: ${err.message}`);
  }
}

execSync('sleep 1.5');

const leftover = listListenPids(port);
for (const pid of leftover) {
  try {
    process.kill(Number(pid), 'SIGKILL');
    console.log(`已强制终止: PID ${pid}`);
  } catch (err) {
    console.error(`强制终止失败 PID ${pid}: ${err.message}`);
  }
}

const still = listListenPids(port);
if (still.length === 0) {
  console.log(`端口 ${port} 已释放`);
} else {
  console.error(`端口 ${port} 仍被占用: ${still.join(', ')}`);
  process.exit(1);
}
