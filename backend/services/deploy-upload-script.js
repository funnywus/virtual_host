/**
 * 将 PHP 分片直传接收脚本下发到站点 _vhost/ 目录（对用户隐藏、FTP 不可删）
 */
const fs = require('fs');
const path = require('path');
const {
  VHOST_DIR,
  UPLOAD_SCRIPT,
  UPLOAD_TMP,
  scriptRelPath,
} = require('./upload-system-files');

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'upload.php');
const DEFAULT_NGINX_PATH = '/www/server/panel/vhost/nginx';

/** 同主机 PHP sock 探测缓存 */
const phpSockCache = new Map(); // hostKey -> { sock, expireAt }
const PHP_SOCK_TTL_MS = 10 * 60 * 1000;

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function sshHostKey(sshService) {
  const s = sshService?.server || {};
  return `${s.ip || ''}:${s.port || 22}:${s.username || ''}`;
}

function getSiteNginxConfPath(fullDomain, nginxPath) {
  const base = (nginxPath || DEFAULT_NGINX_PATH).replace(/\/$/, '');
  return `${base}/${fullDomain}.conf`;
}

function buildScriptContent() {
  const { getUploadSignSecret } = require('../utils/env-check');
  const secret = getUploadSignSecret();
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  return template.replace(/__SIGN_SECRET__/g, secret);
}

/**
 * @param {SshFtpService} sshService
 * @param {string} homeDir 站点根目录
 */
async function deployUploadScript(sshService, homeDir) {
  if (!homeDir || !homeDir.startsWith('/')) {
    return { success: false, message: '无效的站点目录' };
  }

  const content = buildScriptContent();
  const vhostDir = path.posix.join(homeDir, VHOST_DIR);
  const remotePath = path.posix.join(vhostDir, UPLOAD_SCRIPT);
  const tmpDir = path.posix.join(vhostDir, UPLOAD_TMP);
  const legacyScript = path.posix.join(homeDir, UPLOAD_SCRIPT);
  const legacyTmp = path.posix.join(homeDir, UPLOAD_TMP);
  const b64 = Buffer.from(content, 'utf8').toString('base64');

  // 单次 SSH：目录/写文件/权限/ACL/清理旧脚本
  const script = `
set -e
HOME_DIR=${shellQuote(homeDir)}
VHOST_DIR=${shellQuote(vhostDir)}
REMOTE=${shellQuote(remotePath)}
TMP_DIR=${shellQuote(tmpDir)}
LEGACY=${shellQuote(legacyScript)}
LEGACY_TMP=${shellQuote(legacyTmp)}
mkdir -p "$HOME_DIR" "$VHOST_DIR" "$TMP_DIR"
chattr -i "$REMOTE" 2>/dev/null || true
echo ${shellQuote(b64)} | base64 -d > "$REMOTE"
chown www:www "$VHOST_DIR" 2>/dev/null || chown www-data:www-data "$VHOST_DIR" 2>/dev/null || true
chmod 755 "$VHOST_DIR"
chmod 644 "$REMOTE"
chown www:www "$REMOTE" 2>/dev/null || chown www-data:www-data "$REMOTE" 2>/dev/null || true
chattr +i "$REMOTE" 2>/dev/null || true
chmod 777 "$TMP_DIR"
chown www:www "$TMP_DIR" 2>/dev/null || chown www-data:www-data "$TMP_DIR" 2>/dev/null || true
if setfacl -m u:www:rwx "$HOME_DIR" 2>/dev/null && setfacl -d -m u:www:rwx "$HOME_DIR" 2>/dev/null; then
  true
else
  chgrp www "$HOME_DIR" 2>/dev/null || chgrp www-data "$HOME_DIR" 2>/dev/null || true
  chmod 775 "$HOME_DIR" 2>/dev/null || true
fi
chattr -i "$LEGACY" 2>/dev/null || true
rm -f "$LEGACY" 2>/dev/null || true
rm -rf "$LEGACY_TMP" 2>/dev/null || true
echo DEPLOY_OK
`.trim();

  const result = await sshService.exec(script);
  if (!result.success || !(result.output || '').includes('DEPLOY_OK')) {
    return { success: false, message: result.output || '写入 upload.php 失败' };
  }

  return {
    success: true,
    message: '直传脚本下发成功',
    remotePath,
    relPath: scriptRelPath(),
  };
}

async function getInstalledPhpVersions(sshService) {
  const r = await sshService.exec('ls -1 /www/server/php 2>/dev/null | grep -E "^[0-9]+" | sort -n');
  return (r.output || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

async function isSocketPath(sshService, sockPath) {
  if (!sockPath || !sockPath.startsWith('/')) return false;
  const r = await sshService.exec(`test -S ${shellQuote(sockPath)} && echo 1 || echo 0`);
  return (r.output || '').includes('1');
}

async function tryStartPhpFpm(sshService) {
  const versions = await getInstalledPhpVersions(sshService);
  if (versions.length === 0) {
    return { started: false, message: '服务器 /www/server/php 下未安装 PHP' };
  }

  for (const ver of [...versions].reverse()) {
    await sshService.exec(`sudo /etc/init.d/php-fpm-${ver} start 2>/dev/null || true`);
    await sshService.exec(`sudo /www/server/php/${ver}/sbin/php-fpm --daemonize 2>/dev/null || true`);
    await sshService.exec(`sudo systemctl start php-fpm-${ver} 2>/dev/null || true`);
  }

  return { started: true, versions };
}

/** 从宝塔/常见路径探测 PHP-FPM sock（/tmp 以外也兼容） */
async function detectPhpSock(sshService, confPath) {
  const key = sshHostKey(sshService);
  const cached = phpSockCache.get(key);
  if (cached && cached.expireAt > Date.now() && cached.sock) {
    if (await isSocketPath(sshService, cached.sock)) return cached.sock;
  }

  // 合并探测为一次 SSH（conf 内优先，再全局）
  const confProbe = confPath
    ? `grep -oE 'fastcgi_pass[[:space:]]*unix:[^;]+' ${shellQuote(confPath)} 2>/dev/null | head -1 | sed -E 's/fastcgi_pass[[:space:]]*unix://'`
    : 'true';
  const probe = await sshService.exec(`
SOCK=""
C=$(${confProbe} | head -1 | tr -d '[:space:]')
if [ -n "$C" ] && [ -S "$C" ]; then SOCK="$C"; fi
if [ -z "$SOCK" ]; then
  for C in $(ls -t /tmp/php-cgi-*.sock /dev/shm/php-cgi-*.sock 2>/dev/null); do
    [ -S "$C" ] && SOCK="$C" && break
  done
fi
if [ -z "$SOCK" ]; then
  C=$(grep -rh 'fastcgi_pass[[:space:]]*unix:' /www/server/nginx/conf/enable-php-*.conf 2>/dev/null | head -1 | sed -E 's/.*unix:([^;]+);.*/\\1/' | tr -d '[:space:]')
  [ -n "$C" ] && [ -S "$C" ] && SOCK="$C"
fi
if [ -z "$SOCK" ]; then
  C=$(find /www/server/php -name "*.sock" 2>/dev/null | head -1)
  [ -n "$C" ] && [ -S "$C" ] && SOCK="$C"
fi
echo "PHP_SOCK:$SOCK"
`.trim());

  let sock = '';
  const m = String(probe.output || '').match(/PHP_SOCK:(\S*)/);
  if (m && m[1]) sock = m[1];

  if (!sock) {
    const start = await tryStartPhpFpm(sshService);
    if (start.started) {
      const again = await sshService.exec(`
SOCK=""
for C in $(ls -t /tmp/php-cgi-*.sock /dev/shm/php-cgi-*.sock 2>/dev/null); do
  [ -S "$C" ] && SOCK="$C" && break
done
echo "PHP_SOCK:$SOCK"
`.trim());
      const m2 = String(again.output || '').match(/PHP_SOCK:(\S*)/);
      if (m2 && m2[1]) sock = m2[1];
    }
  }

  if (sock) {
    phpSockCache.set(key, { sock, expireAt: Date.now() + PHP_SOCK_TTL_MS });
  }
  return sock;
}

async function diagnosePhpEnvironment(sshService) {
  const versions = await getInstalledPhpVersions(sshService);
  const enableConf = await sshService.exec('ls /www/server/nginx/conf/enable-php-*.conf 2>/dev/null | wc -l');
  const enableCount = parseInt((enableConf.output || '0').trim(), 10) || 0;
  return { versions, enableCount };
}

async function detectEnablePhpConf(sshService, sock) {
  const verMatch = sock.match(/php-cgi-(\d+)/) || sock.match(/\/php\/(\d+)\//);
  if (verMatch) {
    const conf = `/www/server/nginx/conf/enable-php-${verMatch[1]}.conf`;
    const exists = await sshService.exec(`test -f ${shellQuote(conf)} && echo 1 || echo 0`);
    if ((exists.output || '').includes('1')) return conf;
  }
  const find = await sshService.exec('ls -t /www/server/nginx/conf/enable-php-*.conf 2>/dev/null | head -1');
  return (find.output || '').trim() || null;
}

async function hasPhpInConf(sshService, confPath) {
  const r = await sshService.exec(
    `grep -qiE 'enable-php|fastcgi_pass|php-cgi|php.*\\.sock' ${shellQuote(confPath)} && echo 1 || echo 0`
  );
  return (r.output || '').includes('1');
}

function buildPhpLocationBlock(sock) {
  return [
    '    # PHP配置（自动补齐）',
    '    location ~ \\.php$ {',
    `        fastcgi_pass unix:${sock};`,
    '        fastcgi_index index.php;',
    '        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;',
    '        include fastcgi_params;',
    '    }',
  ].join('\n');
}

async function perlInsertLines(sshService, confPath, insertText, mode) {
  const qPath = shellQuote(confPath);
  const b64 = Buffer.from(insertText, 'utf8').toString('base64');
  const qB64 = shellQuote(b64);
  const perlScript = mode === 'before_rewrite'
    ? 'if (/#REWRITE-END/) { $_ = $ins . "\\n" . $_ }'
    : 'if (/^\\s*root\\s/) { $_ = $_ . $ins . "\\n" }';
  const cmd = [
    'export INS=$(echo', qB64, '| base64 -d) &&',
    `sudo perl -i -pe 'our $ins = $ENV{INS}; ${perlScript}' ${qPath}`,
  ].join(' ');
  const r = await sshService.exec(cmd);
  if (!r.success) {
    return { success: false, message: '写入 PHP 配置失败: ' + (r.output || '') };
  }
  return { success: true };
}

async function insertPhpConfig(sshService, confPath, sock) {
  const enableConf = await detectEnablePhpConf(sshService, sock);
  const insertText = enableConf
    ? `    include ${enableConf};`
    : buildPhpLocationBlock(sock);

  const rewrite = await sshService.exec(`grep -c '#REWRITE-END' ${shellQuote(confPath)} 2>/dev/null || echo 0`);
  const rewriteCount = parseInt((rewrite.output || '0').trim(), 10) || 0;
  const mode = rewriteCount > 0 ? 'before_rewrite' : 'after_root';
  const inserted = await perlInsertLines(sshService, confPath, insertText, mode);
  if (!inserted.success) return inserted;

  return {
    success: true,
    action: enableConf ? 'added_include' : 'added_location',
    detail: enableConf || sock,
  };
}

async function fixFastcgiSock(sshService, confPath, sock) {
  const qPath = shellQuote(confPath);
  const r = await sshService.exec(`sudo sed -i -E "s|fastcgi_pass unix:[^;]*;|fastcgi_pass unix:${sock};|g" ${qPath}`);
  return r.success;
}

async function fixEnablePhpIncludeVersion(sshService, confPath, sock) {
  const enableConf = await detectEnablePhpConf(sshService, sock);
  if (!enableConf) return false;
  const qPath = shellQuote(confPath);
  const r = await sshService.exec(
    `grep -q 'enable-php' ${qPath} && sudo sed -i -E "s|include /www/server/nginx/conf/enable-php-[0-9]+\\.conf;|include ${enableConf};|g" ${qPath} && echo 1 || echo 0`
  );
  return (r.output || '').includes('1');
}

async function reloadNginxIfOk(sshService) {
  const test = await sshService.exec('sudo nginx -t 2>&1');
  if (!/successful/i.test(test.output || '') && !test.success) {
    return { ok: false, message: 'nginx 配置测试未通过: ' + (test.output || '') };
  }
  await sshService.exec('sudo nginx -s reload 2>&1 || sudo systemctl reload nginx');
  return { ok: true };
}

/**
 * 补齐/修正站点 nginx 的 PHP 配置（老站点缺 PHP 段、sock 路径错误均可修复）
 * @param {SshFtpService} sshService
 * @param {string} confPath nginx 站点配置文件绝对路径
 * @param {{ reload?: boolean }} options 批量场景可传 reload:false，由调用方统一 reload
 */
async function ensureSitePhpConfig(sshService, confPath, options = {}) {
  const shouldReload = options.reload !== false;
  const exists = await sshService.exec(`test -f ${shellQuote(confPath)} && echo 1 || echo 0`);
  if (!(exists.output || '').includes('1')) {
    return { success: false, message: `站点配置不存在: ${confPath}` };
  }

  let sock = await detectPhpSock(sshService, confPath);
  if (!sock) {
    const diag = await diagnosePhpEnvironment(sshService);
    if (diag.versions.length === 0) {
      return {
        success: false,
        message: '服务器未安装 PHP，请在宝塔面板 → 软件商店 安装 PHP（如 7.4/8.0）',
        diagnose: diag,
      };
    }
    return {
      success: false,
      message: `PHP 已安装（${diag.versions.join(', ')}）但 FPM 未运行或 sock 不存在，请在宝塔重启 PHP-${diag.versions[diag.versions.length - 1]}`,
      diagnose: diag,
    };
  }

  let action = 'unchanged';
  const hasPhp = await hasPhpInConf(sshService, confPath);

  if (!hasPhp) {
    const inserted = await insertPhpConfig(sshService, confPath, sock);
    if (!inserted.success) return inserted;
    action = inserted.action;
  } else {
    await fixFastcgiSock(sshService, confPath, sock);
    const fixedInclude = await fixEnablePhpIncludeVersion(sshService, confPath, sock);
    action = fixedInclude ? 'fixed_include' : 'fixed_sock';
  }

  if (shouldReload) {
    const reload = await reloadNginxIfOk(sshService);
    if (!reload.ok) {
      return { success: false, message: reload.message };
    }
  }

  const messages = {
    added_include: '已补齐 PHP 配置（宝塔 enable-php include）',
    added_location: '已补齐 PHP 配置（location 块）',
    fixed_sock: `PHP sock 已修正为 ${sock}`,
    fixed_include: `PHP 版本 include 已更新（${sock}）`,
    unchanged: 'PHP 配置正常',
  };

  return { success: true, action, message: messages[action] || messages.unchanged, sock, reloaded: shouldReload };
}

/** @deprecated 使用 ensureSitePhpConfig */
async function fixSitePhpSock(sshService, confPath, options = {}) {
  return ensureSitePhpConfig(sshService, confPath, options);
}

/**
 * 下发直传脚本后顺带补齐 PHP（按域名定位 nginx 配置）
 */
async function ensureSitePhpAfterDeploy(sshService, fullDomain, nginxPath, options = {}) {
  if (!fullDomain) {
    return { success: false, message: '缺少域名，无法定位 nginx 配置' };
  }
  const confPath = getSiteNginxConfPath(fullDomain, nginxPath);
  return ensureSitePhpConfig(sshService, confPath, options);
}

/**
 * 在服务器本机探测直传端点（绕过公网 DNS/CDN），区分「脚本问题」和「公网 HTTPS 问题」
 * @returns {{ https_code: number|null, http_code: number|null, ok: boolean, message: string }}
 */
async function probeDirectUploadLocal(sshService, fullDomain, uploadPath = '/_vhost/upload.php') {
  if (!fullDomain) {
    return { https_code: null, http_code: null, ok: false, message: '缺少域名' };
  }
  const path = uploadPath.startsWith('/') ? uploadPath : `/${uploadPath}`;

  // HTTPS：把域名解析到本机 127.0.0.1，验证证书+nginx+php 本机链路
  const httpsCmd = [
    `curl -sk -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 6`,
    `--resolve ${fullDomain}:443:127.0.0.1`,
    `-X GET "https://${fullDomain}${path}?action=status&uploadId=probecheck0"`,
    `2>/dev/null || echo 000`
  ].join(' ');

  // HTTP：Host 头访问本机 80，验证 nginx+php（不含证书）
  const httpCmd = [
    `curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 6`,
    `-H ${shellQuote(`Host: ${fullDomain}`)}`,
    `"http://127.0.0.1${path}?action=status&uploadId=probecheck0"`,
    `2>/dev/null || echo 000`
  ].join(' ');

  const [httpsRes, httpRes] = await Promise.all([
    sshService.exec(httpsCmd, 15000),
    sshService.exec(httpCmd, 15000)
  ]);

  const parseCode = (out) => {
    const m = String(out || '').trim().match(/(\d{3})\s*$/);
    return m ? parseInt(m[1], 10) : 0;
  };

  const httpsCode = parseCode(httpsRes.output);
  const httpCode = parseCode(httpRes.output);
  const alive = (c) => [200, 400, 401, 403, 405].includes(c);

  let message = '';
  if (alive(httpsCode)) {
    message = `本机 HTTPS 正常 (HTTP ${httpsCode})，若浏览器探测失败多半是公网证书/CDN/防火墙问题`;
  } else if (alive(httpCode)) {
    message = `本机 HTTP 正常 (HTTP ${httpCode})，但 HTTPS 失败 (${httpsCode || '无响应'})，请检查 SSL 证书与 443`;
  } else if (httpsCode === 404 || httpCode === 404) {
    message = `本机可访问但 ${path} 返回 404，请补发直传脚本`;
  } else if (httpsCode === 502 || httpCode === 502) {
    message = '本机返回 502，PHP-FPM / sock 可能异常，请补齐 PHP 配置';
  } else {
    message = `本机探测失败 (https=${httpsCode || 0}, http=${httpCode || 0})，请检查 nginx 是否监听、站点是否启用`;
  }

  return {
    https_code: httpsCode || null,
    http_code: httpCode || null,
    ok: alive(httpsCode) || alive(httpCode),
    message,
    path,
    domain: fullDomain
  };
}

module.exports = {
  deployUploadScript,
  buildScriptContent,
  fixSitePhpSock,
  ensureSitePhpConfig,
  ensureSitePhpAfterDeploy,
  getSiteNginxConfPath,
  probeDirectUploadLocal,
};
