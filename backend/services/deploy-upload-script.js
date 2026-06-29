/**
 * 将 PHP 分片直传接收脚本（upload.php）下发到目标站点目录
 * 下发时把模板里的 __SIGN_SECRET__ 替换为后台共享密钥
 */
const fs = require('fs');
const path = require('path');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'upload.php');

// shell 单引号转义
function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

/**
 * 读取模板并注入密钥
 */
function buildScriptContent() {
  const secret = process.env.UPLOAD_SIGN_SECRET || 'change_this_to_a_long_random_secret_string';
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  return template.replace(/__SIGN_SECRET__/g, secret);
}

/**
 * 通过已建立的 SshFtpService 把 upload.php 写入站点目录
 * @param {SshFtpService} sshService
 * @param {string} homeDir 站点根目录，如 /www/wwwroot/ftp/sub.example.com
 * @returns {Promise<{success:boolean, message:string}>}
 */
async function deployUploadScript(sshService, homeDir) {
  if (!homeDir || !homeDir.startsWith('/')) {
    return { success: false, message: '无效的站点目录' };
  }

  const content = buildScriptContent();
  const remotePath = path.posix.join(homeDir, 'upload.php');

  // 确保目录存在
  await sshService.exec(`mkdir -p ${shellQuote(homeDir)}`);

  // 通过 base64 传输，避免 PHP 内容里的特殊字符在 shell 中被破坏
  const b64 = Buffer.from(content, 'utf8').toString('base64');
  const writeCmd = `echo ${shellQuote(b64)} | base64 -d > ${shellQuote(remotePath)}`;
  const result = await sshService.exec(writeCmd);
  if (!result.success) {
    return { success: false, message: result.output || '写入 upload.php 失败' };
  }

  // 权限：让 PHP 运行用户可读执行
  await sshService.exec(`chmod 644 ${shellQuote(remotePath)}`);
  await sshService.exec(`chown www:www ${shellQuote(remotePath)} 2>/dev/null || chown www-data:www-data ${shellQuote(remotePath)} 2>/dev/null || true`);

  return { success: true, message: 'upload.php 下发成功', remotePath };
}

/**
 * 探测服务器真实的 php-fpm sock，并修正站点 nginx 配置里的 fastcgi_pass
 * 解决「配置写死 /tmp/php-cgi.sock 但宝塔实际是 /tmp/php-cgi-74.sock」导致的 502
 * @param {SshFtpService} sshService
 * @param {string} confPath 站点 nginx 配置文件路径
 * @returns {Promise<{success:boolean, message:string, sock?:string}>}
 */
async function fixSitePhpSock(sshService, confPath) {
  // 1. 探测真实 sock（取版本最高/最新的一个）
  const probe = await sshService.exec(`ls -t /tmp/php-cgi-*.sock 2>/dev/null | head -1`);
  const sock = (probe.output || '').trim();
  if (!sock) {
    return { success: false, message: '服务器未检测到 PHP（无 php-cgi sock），请先在宝塔安装 PHP 版本' };
  }

  // 2. 确认配置文件存在
  const exists = await sshService.exec(`test -f ${shellQuote(confPath)} && echo 1 || echo 0`);
  if (!(exists.output || '').includes('1')) {
    return { success: false, message: `站点配置不存在: ${confPath}` };
  }

  // 3. 配置里是否已有 php 的 fastcgi_pass
  const hasPhp = await sshService.exec(`grep -q 'fastcgi_pass' ${shellQuote(confPath)} && echo 1 || echo 0`);
  if (!(hasPhp.output || '').includes('1')) {
    return { success: false, message: '站点 nginx 配置中没有 PHP 处理段，可能是纯静态站点' };
  }

  // 4. 用真实 sock 替换 fastcgi_pass（用 | 作分隔符避免路径斜杠冲突）
  const sed = `sudo sed -i -E "s|fastcgi_pass unix:[^;]*;|fastcgi_pass unix:${sock};|g" ${shellQuote(confPath)}`;
  const r = await sshService.exec(sed);
  if (!r.success) {
    return { success: false, message: '修改 nginx 配置失败: ' + (r.output || '') };
  }

  // 5. 测试并重载 nginx
  const test = await sshService.exec('sudo nginx -t 2>&1');
  if (!/successful/i.test(test.output || '') && !test.success) {
    return { success: false, message: 'nginx 配置测试未通过: ' + (test.output || '') };
  }
  await sshService.exec('sudo nginx -s reload 2>&1 || sudo systemctl reload nginx');

  return { success: true, message: `PHP sock 已修正为 ${sock}`, sock };
}

module.exports = { deployUploadScript, buildScriptContent, fixSitePhpSock };
