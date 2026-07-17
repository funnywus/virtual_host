/**
 * 子域名停用 / 启用：通过 Nginx 即时生效，不改动 DNS。
 */
const db = require('../db/database');
const SshFtpService = require('./ssh-ftp');
const nginxConfig = require('./nginx-config');

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function nginxTestPassed(result) {
  return result.success || result.output?.includes('successful');
}

function getFullDomain(sub) {
  if (sub.full_domain) return sub.full_domain;
  if (!sub.main_domain) return sub.subdomain;
  return sub.subdomain === '@' ? sub.main_domain : `${sub.subdomain}.${sub.main_domain}`;
}

const DISABLED_PAGE_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>站点已停用</title>
  <style>
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f7fa;color:#303133}
    .box{text-align:center;padding:40px 32px;background:#fff;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.08);max-width:420px}
    h1{margin:0 0 12px;font-size:22px}
    p{margin:0;color:#909399;line-height:1.6}
  </style>
</head>
<body>
  <div class="box">
    <h1>站点已停用</h1>
    <p>该站点已过期或被管理员停用。<br>如需继续使用，请联系管理员恢复。</p>
  </div>
</body>
</html>
`;

function generateDisabledConfig(domain, rootPath, options = {}) {
  const mainDomain = options.mainDomain || domain;
  const certPaths = nginxConfig.getCertPaths(mainDomain);
  const withSsl = options.withSsl !== false;

  const httpBlock = `server {
    listen 80;
    server_name ${domain};
    root ${rootPath};
    index index.html;
    location / {
        try_files $uri /index.html =403;
    }
    access_log off;
}`;

  if (!withSsl) return httpBlock;

  return `${httpBlock}

server {
    listen 443 ssl http2;
    server_name ${domain};
    root ${rootPath};
    index index.html;
    ssl_certificate ${certPaths.fullchain};
    ssl_certificate_key ${certPaths.key};
    ssl_protocols TLSv1.2 TLSv1.3;
    location / {
        try_files $uri /index.html =403;
    }
    access_log off;
}`;
}

async function loadSubdomainContext(subdomainId) {
  return db.get(`
    SELECT s.*, d.domain as main_domain,
           CASE WHEN s.subdomain = '@' THEN d.domain ELSE ${db.concat('s.subdomain', `'.'`, 'd.domain')} END as full_domain,
           sv.id as server_db_id, sv.ip, sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass
    FROM subdomains s
    LEFT JOIN domains d ON s.domain_id = d.id
    LEFT JOIN servers sv ON s.server_id = sv.id
    WHERE s.id = ?
  `, [subdomainId]);
}

async function writeAndReloadNginx(sshService, configPath, configContent) {
  const writeResult = await sshService.exec(
    `printf %s ${shellQuote(configContent)} | sudo tee ${shellQuote(configPath)} >/dev/null`
  );
  if (!writeResult.success) {
    return { success: false, message: '写入 Nginx 配置失败: ' + (writeResult.output || '') };
  }

  const testResult = await sshService.exec('sudo nginx -t 2>&1');
  if (!nginxTestPassed(testResult)) {
    return { success: false, message: 'Nginx 配置测试失败: ' + (testResult.output || ''), needHttpFallback: true };
  }

  const reloadResult = await sshService.exec('sudo nginx -s reload 2>&1 || sudo systemctl reload nginx 2>&1');
  if (!reloadResult.success) {
    return { success: false, message: 'Nginx 重载失败: ' + (reloadResult.output || '') };
  }

  return { success: true };
}

async function applyNginxToServer(sub, configContent) {
  if (!sub.ip || !sub.ssh_user) {
    return { success: false, message: '未关联服务器，已仅更新数据库状态', skipped: true };
  }

  const fullDomain = getFullDomain(sub);
  const configPath = nginxConfig.getConfigPath(fullDomain);
  const sshService = new SshFtpService({
    ip: sub.ip,
    port: sub.ssh_port,
    username: sub.ssh_user,
    password: sub.ssh_pass
  });

  let result = await writeAndReloadNginx(sshService, configPath, configContent);
  return { ...result, sshService, configPath, fullDomain };
}

async function applyDisabledNginx(sub) {
  if (!sub.ip || !sub.ssh_user) {
    return { success: false, message: '未关联服务器，已仅更新数据库状态', skipped: true };
  }

  const fullDomain = getFullDomain(sub);
  const configPath = nginxConfig.getConfigPath(fullDomain);
  const disabledRoot = `/www/server/panel/vhost/nginx/_disabled/${fullDomain}`;
  const sshService = new SshFtpService({
    ip: sub.ip,
    port: sub.ssh_port,
    username: sub.ssh_user,
    password: sub.ssh_pass
  });

  await sshService.exec(`sudo mkdir -p ${shellQuote(disabledRoot)}`);
  await sshService.exec(
    `printf %s ${shellQuote(DISABLED_PAGE_HTML)} | sudo tee ${shellQuote(`${disabledRoot}/index.html`)} >/dev/null`
  );

  let config = generateDisabledConfig(fullDomain, disabledRoot, {
    mainDomain: sub.main_domain,
    withSsl: true
  });
  let result = await writeAndReloadNginx(sshService, configPath, config);

  if (!result.success && result.needHttpFallback) {
    config = generateDisabledConfig(fullDomain, disabledRoot, {
      mainDomain: sub.main_domain,
      withSsl: false
    });
    result = await writeAndReloadNginx(sshService, configPath, config);
  }

  return result;
}

/**
 * 停用：写入禁用 Nginx 配置，保留 DNS 与 aliyun_record_id
 */
async function disableSubdomain(subdomainId) {
  const sub = await loadSubdomainContext(subdomainId);
  if (!sub) {
    return { success: false, message: 'Subdomain not found' };
  }

  const nginxResult = await applyDisabledNginx(sub);

  // 只改使用状态，不动 DNS 相关字段（aliyun_record_id / status）
  await db.run(
    'UPDATE subdomains SET use_status = ? WHERE id = ?',
    ['disabled', subdomainId]
  );

  const nginxOk = !!(nginxResult.skipped || nginxResult.success);
  return {
    success: nginxOk,
    db_updated: true,
    message: nginxResult.skipped
      ? '已停用（无服务器，未同步 Nginx）'
      : (nginxResult.success ? '已停用（Nginx 已禁用，DNS 未改动）' : `数据库已停用，但 Nginx 同步失败: ${nginxResult.message}`),
    nginx: nginxResult
  };
}

/**
 * 启用：恢复数据库中的 nginx_config，保留 DNS
 */
async function enableSubdomain(subdomainId, useStatus = 'unused') {
  const sub = await loadSubdomainContext(subdomainId);
  if (!sub) {
    return { success: false, message: 'Subdomain not found' };
  }

  const targetStatus = (useStatus === 'used' || useStatus === 'unused') ? useStatus : 'unused';
  let nginxResult = { success: true, skipped: true };

  if (sub.nginx_config) {
    nginxResult = await applyNginxToServer(sub, sub.nginx_config);
  } else if (sub.ip) {
    const fullDomain = getFullDomain(sub);
    const generated = nginxConfig.generateConfig('https', fullDomain, {
      rootPath: `/www/wwwroot/ftp/${fullDomain}`,
      mainDomain: sub.main_domain
    });
    await db.run('UPDATE subdomains SET nginx_config = ? WHERE id = ?', [generated, subdomainId]);
    nginxResult = await applyNginxToServer(sub, generated);
  }

  await db.run(
    'UPDATE subdomains SET use_status = ?, nginx_synced = ? WHERE id = ?',
    [targetStatus, nginxResult.success && !nginxResult.skipped ? 1 : 0, subdomainId]
  );

  const nginxOk = !!(nginxResult.skipped || nginxResult.success);
  return {
    success: nginxOk,
    db_updated: true,
    message: nginxResult.skipped
      ? '已启用（无 Nginx 配置可同步）'
      : (nginxResult.success ? '已启用（Nginx 已恢复，DNS 未改动）' : `数据库已启用，但 Nginx 同步失败: ${nginxResult.message}`),
    nginx: nginxResult,
    use_status: targetStatus
  };
}

module.exports = {
  disableSubdomain,
  enableSubdomain,
  generateDisabledConfig,
  loadSubdomainContext
};
