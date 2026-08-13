/**
 * 子域名停用 / 启用：通过 Nginx 即时生效，不改动 DNS。
 * 批量操作：同服并行写配置 → 一次 -t → 一次 reload；失败统一回退备份。
 */
const db = require('../db/database');
const SshFtpService = require('./ssh-ftp');
const nginxConfig = require('./nginx-config');
const { decryptSecret } = require('../utils/secret-crypto');

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

function resolveSshPassword(sub) {
  return decryptSecret(sub.ssh_pass);
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

async function loadSubdomainContexts(ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.all(`
    SELECT s.*, d.domain as main_domain,
           CASE WHEN s.subdomain = '@' THEN d.domain ELSE ${db.concat('s.subdomain', `'.'`, 'd.domain')} END as full_domain,
           sv.id as server_db_id, sv.ip, sv.port as ssh_port, sv.username as ssh_user, sv.password as ssh_pass
    FROM subdomains s
    LEFT JOIN domains d ON s.domain_id = d.id
    LEFT JOIN servers sv ON s.server_id = sv.id
    WHERE s.id IN (${placeholders})
  `, ids);
}

function createSshService(sub) {
  return new SshFtpService({
    ip: sub.ip,
    port: sub.ssh_port,
    username: sub.ssh_user,
    password: resolveSshPassword(sub)
  });
}

async function mapPool(items, concurrency, worker) {
  const list = [...items];
  const results = new Array(list.length);
  let cursor = 0;
  async function run() {
    while (cursor < list.length) {
      const i = cursor;
      cursor += 1;
      results[i] = await worker(list[i], i);
    }
  }
  const n = Math.min(Math.max(1, concurrency), list.length || 1);
  await Promise.all(Array.from({ length: n }, () => run()));
  return results;
}

async function writeAndReloadNginx(sshService, configPath, configContent) {
  const backupPath = `${configPath}.bak.${Date.now()}`;
  await sshService.exec(
    `if [ -f ${shellQuote(configPath)} ]; then sudo cp ${shellQuote(configPath)} ${shellQuote(backupPath)}; else true; fi`
  );

  const writeResult = await sshService.exec(
    `printf %s ${shellQuote(configContent)} | sudo tee ${shellQuote(configPath)} >/dev/null`
  );
  if (!writeResult.success) {
    await restoreBackup(sshService, configPath, backupPath);
    return { success: false, message: '写入 Nginx 配置失败: ' + (writeResult.output || '') };
  }

  const testResult = await sshService.exec('sudo nginx -t 2>&1');
  if (!nginxTestPassed(testResult)) {
    await restoreBackup(sshService, configPath, backupPath);
    return { success: false, message: 'Nginx 配置测试失败: ' + (testResult.output || ''), needHttpFallback: true };
  }

  const reloadResult = await sshService.exec('sudo nginx -s reload 2>&1 || sudo systemctl reload nginx 2>&1');
  if (!reloadResult.success) {
    await restoreBackup(sshService, configPath, backupPath);
    await sshService.exec('sudo nginx -s reload 2>&1 || sudo systemctl reload nginx 2>&1');
    return { success: false, message: 'Nginx 重载失败，已回退配置: ' + (reloadResult.output || '') };
  }

  await sshService.exec(`sudo rm -f ${shellQuote(backupPath)}`);
  return { success: true };
}

async function restoreBackup(sshService, configPath, backupPath) {
  await sshService.exec(`
if [ -f ${shellQuote(backupPath)} ]; then
  sudo cp ${shellQuote(backupPath)} ${shellQuote(configPath)}
  sudo rm -f ${shellQuote(backupPath)}
else
  sudo rm -f ${shellQuote(configPath)}
fi
`.trim());
}

async function applyNginxToServer(sub, configContent) {
  if (!sub.ip || !sub.ssh_user) {
    return { success: false, message: '未关联服务器，已仅更新数据库状态', skipped: true };
  }

  const fullDomain = getFullDomain(sub);
  const configPath = nginxConfig.getConfigPath(fullDomain);
  const sshService = createSshService(sub);

  if (configContent && configContent.includes('vhost_traffic')) {
    try {
      await nginxConfig.ensureTrafficLogFormat(sshService);
    } catch (e) {
      console.error('下发流量日志格式失败:', e.message);
    }
  }

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
  const sshService = createSshService(sub);

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
 * 停用：先同步 Nginx，成功后再改库（失败不改状态）
 */
async function disableSubdomain(subdomainId) {
  const sub = await loadSubdomainContext(subdomainId);
  if (!sub) {
    return { success: false, message: 'Subdomain not found' };
  }

  const nginxResult = await applyDisabledNginx(sub);
  if (!nginxResult.skipped && !nginxResult.success) {
    return {
      success: false,
      db_updated: false,
      message: `停用失败，已回退 Nginx：${nginxResult.message}`,
      nginx: nginxResult
    };
  }

  await db.run('UPDATE subdomains SET use_status = ? WHERE id = ?', ['disabled', subdomainId]);

  return {
    success: true,
    db_updated: true,
    message: nginxResult.skipped
      ? '已停用（无服务器，未同步 Nginx）'
      : '已停用（Nginx 已禁用，DNS 未改动）',
    nginx: nginxResult
  };
}

/**
 * 启用：先恢复 Nginx，成功后再改库
 */
async function enableSubdomain(subdomainId, useStatus = 'unused') {
  const sub = await loadSubdomainContext(subdomainId);
  if (!sub) {
    return { success: false, message: 'Subdomain not found' };
  }

  const targetStatus = (useStatus === 'used' || useStatus === 'unused') ? useStatus : 'unused';
  let nginxResult = { success: true, skipped: true };
  let generatedConfig = null;

  if (sub.nginx_config) {
    nginxResult = await applyNginxToServer(sub, sub.nginx_config);
  } else if (sub.ip) {
    const fullDomain = getFullDomain(sub);
    generatedConfig = nginxConfig.generateConfig('https', fullDomain, {
      rootPath: `/www/wwwroot/ftp/${fullDomain}`,
      mainDomain: sub.main_domain
    });
    nginxResult = await applyNginxToServer(sub, generatedConfig);
  }

  if (!nginxResult.skipped && !nginxResult.success) {
    return {
      success: false,
      db_updated: false,
      message: `启用失败，已回退 Nginx：${nginxResult.message}`,
      nginx: nginxResult,
      use_status: sub.use_status
    };
  }

  if (generatedConfig) {
    await db.run('UPDATE subdomains SET nginx_config = ? WHERE id = ?', [generatedConfig, subdomainId]);
  }

  await db.run(
    'UPDATE subdomains SET use_status = ?, nginx_synced = ? WHERE id = ?',
    [targetStatus, nginxResult.success && !nginxResult.skipped ? 1 : 0, subdomainId]
  );

  return {
    success: true,
    db_updated: true,
    message: nginxResult.skipped
      ? '已启用（无 Nginx 配置可同步）'
      : '已启用（Nginx 已恢复，DNS 未改动）',
    nginx: nginxResult,
    use_status: targetStatus
  };
}

function needsNginxChange(sub, targetStatus) {
  if (targetStatus === 'disabled') return sub.use_status !== 'disabled';
  if (sub.use_status === 'disabled' && (targetStatus === 'used' || targetStatus === 'unused')) return true;
  return false;
}

function buildTargetConfig(sub, targetStatus) {
  const fullDomain = getFullDomain(sub);
  if (targetStatus === 'disabled') {
    const disabledRoot = `/www/server/panel/vhost/nginx/_disabled/${fullDomain}`;
    return {
      fullDomain,
      configPath: nginxConfig.getConfigPath(fullDomain),
      disabledRoot,
      config: generateDisabledConfig(fullDomain, disabledRoot, {
        mainDomain: sub.main_domain,
        withSsl: true
      }),
      fallbackConfig: generateDisabledConfig(fullDomain, disabledRoot, {
        mainDomain: sub.main_domain,
        withSsl: false
      }),
      ensureDisabledPage: true
    };
  }

  let config = sub.nginx_config;
  let generated = false;
  if (!config) {
    config = nginxConfig.generateConfig('https', fullDomain, {
      rootPath: `/www/wwwroot/ftp/${fullDomain}`,
      mainDomain: sub.main_domain
    });
    generated = true;
  }
  return {
    fullDomain,
    configPath: nginxConfig.getConfigPath(fullDomain),
    config,
    generated,
    ensureTrafficFormat: !!(config && config.includes('vhost_traffic'))
  };
}

async function rollbackServerPlan(plan) {
  if (!plan?.sshService || !plan.items?.length) return;
  await mapPool(plan.items, 5, async (item) => {
    await restoreBackup(plan.sshService, item.configPath, item.backupPath);
  });
  await plan.sshService.exec('sudo nginx -s reload 2>&1 || sudo systemctl reload nginx 2>&1');
}

/**
 * 单服：备份 → 并行写 → nginx -t（不 reload）
 */
async function prepareServerGroup(subs, targetStatus, batchId) {
  const sample = subs[0];
  if (!sample.ip || !sample.ssh_user) {
    return {
      success: true,
      skipped: true,
      subs,
      targetStatus,
      items: []
    };
  }

  const sshService = createSshService(sample);
  const items = [];

  // 准备禁用页 / log_format（每服一次）
  const needDisabledPage = targetStatus === 'disabled';
  const needTrafficFormat = targetStatus !== 'disabled' && subs.some((s) => {
    const t = buildTargetConfig(s, targetStatus);
    return t.ensureTrafficFormat;
  });

  if (needTrafficFormat) {
    try {
      await nginxConfig.ensureTrafficLogFormat(sshService);
    } catch (e) {
      console.error('下发流量日志格式失败:', e.message);
    }
  }

  // 并行：备份 + 写配置
  const writeResults = await mapPool(subs, 5, async (sub) => {
    const target = buildTargetConfig(sub, targetStatus);
    const backupPath = `${target.configPath}.bak.batch.${batchId}`;

    if (needDisabledPage && target.disabledRoot) {
      await sshService.exec(`sudo mkdir -p ${shellQuote(target.disabledRoot)}`);
      await sshService.exec(
        `printf %s ${shellQuote(DISABLED_PAGE_HTML)} | sudo tee ${shellQuote(`${target.disabledRoot}/index.html`)} >/dev/null`
      );
    }

    const backupResult = await sshService.exec(
      `if [ -f ${shellQuote(target.configPath)} ]; then sudo cp ${shellQuote(target.configPath)} ${shellQuote(backupPath)}; else true; fi`
    );
    if (!backupResult.success) {
      return { success: false, message: `备份失败 ${target.fullDomain}: ${backupResult.output || ''}`, sub, target, backupPath };
    }

    let writeResult = await sshService.exec(
      `printf %s ${shellQuote(target.config)} | sudo tee ${shellQuote(target.configPath)} >/dev/null`
    );

    // 禁用站 SSL 失败时写 HTTP fallback
    if (!writeResult.success) {
      return { success: false, message: `写入失败 ${target.fullDomain}: ${writeResult.output || ''}`, sub, target, backupPath };
    }

    return { success: true, sub, target, backupPath };
  });

  const failedWrite = writeResults.find((r) => !r.success);
  items.push(...writeResults.filter((r) => r.backupPath).map((r) => ({
    sub: r.sub,
    configPath: r.target.configPath,
    backupPath: r.backupPath,
    generated: r.target.generated,
    config: r.target.config
  })));

  const plan = { success: true, sshService, subs, targetStatus, items, wrote: items.length > 0 };

  if (failedWrite) {
    plan.success = false;
    plan.message = failedWrite.message;
    return plan;
  }

  let testResult = await sshService.exec('sudo nginx -t 2>&1');
  if (!nginxTestPassed(testResult) && targetStatus === 'disabled') {
    // 整服降级：重写为 HTTP-only 禁用配置再测
    await mapPool(items, 5, async (item) => {
      const fallback = generateDisabledConfig(getFullDomain(item.sub), `/www/server/panel/vhost/nginx/_disabled/${getFullDomain(item.sub)}`, {
        mainDomain: item.sub.main_domain,
        withSsl: false
      });
      await sshService.exec(`printf %s ${shellQuote(fallback)} | sudo tee ${shellQuote(item.configPath)} >/dev/null`);
      item.config = fallback;
    });
    testResult = await sshService.exec('sudo nginx -t 2>&1');
  }

  if (!nginxTestPassed(testResult)) {
    plan.success = false;
    plan.message = `Nginx 配置测试失败: ${testResult.output || ''}`;
    return plan;
  }

  return plan;
}

async function reloadServerPlan(plan) {
  if (plan.skipped || !plan.sshService) return { success: true, skipped: true };
  const reloadResult = await plan.sshService.exec('sudo nginx -s reload 2>&1 || sudo systemctl reload nginx 2>&1');
  if (!reloadResult.success) {
    return { success: false, message: 'Nginx 重载失败: ' + (reloadResult.output || '') };
  }
  // 清理备份
  await mapPool(plan.items, 5, async (item) => {
    await plan.sshService.exec(`sudo rm -f ${shellQuote(item.backupPath)}`);
  });
  return { success: true };
}

/**
 * 批量改状态：多服并行准备 → 任一步失败则全部回退 → 成功后再统一改库
 */
async function batchSetUseStatus(ids, targetStatus) {
  if (!['unused', 'used', 'disabled'].includes(targetStatus)) {
    return { success: false, message: '无效状态' };
  }

  const subs = await loadSubdomainContexts(ids);
  if (!subs.length) {
    return { success: false, message: '未找到子域名' };
  }

  const dbOnly = [];
  const nginxSubs = [];
  for (const sub of subs) {
    if (needsNginxChange(sub, targetStatus)) nginxSubs.push(sub);
    else dbOnly.push(sub);
  }

  const batchId = `${Date.now()}`;
  const byServer = new Map();
  for (const sub of nginxSubs) {
    const key = sub.server_db_id ? `s:${sub.server_db_id}` : `ip:${sub.ip || 'none'}`;
    if (!byServer.has(key)) byServer.set(key, []);
    byServer.get(key).push(sub);
  }

  // 多服并行准备（写盘 + -t，不 reload）
  const plans = await Promise.all(
    [...byServer.values()].map((group) => prepareServerGroup(group, targetStatus, batchId))
  );

  const prepareFailed = plans.filter((p) => !p.success);
  if (prepareFailed.length > 0) {
    await Promise.all(plans.filter((p) => p.wrote).map((p) => rollbackServerPlan(p)));
    return {
      success: false,
      rolled_back: true,
      message: `批量同步失败，已统一回退：${prepareFailed.map((p) => p.message).join('；')}`,
      failed_servers: prepareFailed.length,
      total: subs.length
    };
  }

  // 多服并行 reload
  const reloadResults = await Promise.all(plans.map((p) => reloadServerPlan(p)));
  const reloadFailed = reloadResults.filter((r) => !r.success && !r.skipped);
  if (reloadFailed.length > 0) {
    await Promise.all(plans.filter((p) => p.wrote).map((p) => rollbackServerPlan(p)));
    return {
      success: false,
      rolled_back: true,
      message: `Nginx 重载失败，已统一回退：${reloadFailed.map((r) => r.message).join('；')}`,
      total: subs.length
    };
  }

  // 全部远端成功后再改库
  await Promise.all(subs.map(async (sub) => {
    const planItem = plans.flatMap((p) => p.items || []).find((i) => i.sub.id === sub.id);
    if (planItem?.generated && planItem.config && targetStatus !== 'disabled') {
      await db.run('UPDATE subdomains SET nginx_config = ? WHERE id = ?', [planItem.config, sub.id]);
    }
    const synced = needsNginxChange(sub, targetStatus) && !!(sub.ip && sub.ssh_user) ? 1 : undefined;
    if (synced !== undefined) {
      await db.run('UPDATE subdomains SET use_status = ?, nginx_synced = ? WHERE id = ?', [targetStatus, synced, sub.id]);
    } else {
      await db.run('UPDATE subdomains SET use_status = ? WHERE id = ?', [targetStatus, sub.id]);
    }
  }));

  // 过期站从 disabled 恢复时临时顺延 7 天
  if (targetStatus === 'used' || targetStatus === 'unused') {
    const now = new Date();
    await Promise.all(subs.map(async (sub) => {
      if (sub.use_status === 'disabled' && sub.expire_at && new Date(sub.expire_at) < now) {
        const extendTo = new Date();
        extendTo.setDate(extendTo.getDate() + 7);
        const pad = (n) => String(n).padStart(2, '0');
        const expireStr = `${extendTo.getFullYear()}-${pad(extendTo.getMonth() + 1)}-${pad(extendTo.getDate())} ${pad(extendTo.getHours())}:${pad(extendTo.getMinutes())}:${pad(extendTo.getSeconds())}`;
        await db.run('UPDATE subdomains SET expire_at = ? WHERE id = ?', [expireStr, sub.id]);
      }
    }));
  }

  return {
    success: true,
    rolled_back: false,
    message: `已批量更新 ${subs.length} 个站点为 ${targetStatus}` +
      (nginxSubs.length ? `（${byServer.size} 台服务器并行同步，每服 1 次 reload）` : ''),
    total: subs.length,
    nginx_count: nginxSubs.length,
    db_only_count: dbOnly.length,
    servers: byServer.size
  };
}

module.exports = {
  disableSubdomain,
  enableSubdomain,
  batchSetUseStatus,
  generateDisabledConfig,
  loadSubdomainContext,
  loadSubdomainContexts,
  mapPool
};
