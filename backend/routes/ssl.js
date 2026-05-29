const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db/database');
const { authMiddleware } = require('../middleware/auth');
const SshFtpService = require('../services/ssh-ftp');
const sslCert = require('../services/ssl-cert');
const { broadcastSslLog } = require('../services/ssl-log-ws');

const router = express.Router();
const LOCAL_CERT_BASE_DIR = path.join(__dirname, '..', 'uploads', 'certs');
const MAX_SSL_LOG_LENGTH = 60000;
const BATCH_JOB_TTL_MS = 24 * 60 * 60 * 1000; // 24小时过期（从2小时延长）
const SSL_INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
const SSL_ISSUE_TIMEOUT_MS = 15 * 60 * 1000;
const batchIssueJobs = new Map();

// 格式化时间为 YYYY-MM-DD HH:mm:ss
const formatTime = (date = new Date()) => {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};

// 解析 openssl 日期格式 (如 "Dec 26 08:11:49 2025 GMT") 为标准格式
const parseOpenSSLDate = (dateStr) => {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return formatTime(d);
  } catch (e) {
    return dateStr;
  }
};

const trimSslLog = (log) => {
  const text = String(log || '');
  if (text.length <= MAX_SSL_LOG_LENGTH) return text;
  const headLength = 8000;
  const notice = `\n...[日志过长，已省略中间内容，原始长度 ${text.length} 字符，保留开头和末尾]\n`;
  const tailLength = MAX_SSL_LOG_LENGTH - headLength - notice.length;
  return `${text.slice(0, headLength)}${notice}${text.slice(-tailLength)}`;
};

const trimCommandOutput = (output, maxLength = 12000) => {
  const text = String(output || '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, 3000)}\n...[输出过长，已省略中间内容，保留末尾]\n${text.slice(-(maxLength - 3050))}`;
};

const updateSslLog = async (domainId, log) => {
  const trimmedLog = trimSslLog(log);
  await db.run('UPDATE domains SET ssl_log = ? WHERE id = ?', [trimmedLog, domainId]);
  broadcastSslLog(domainId, { log: trimmedLog });
};

const updateSslStatusLog = async (domainId, status, log) => {
  const trimmedLog = trimSslLog(log);
  await db.run('UPDATE domains SET ssl_status = ?, ssl_log = ? WHERE id = ?', [status, trimmedLog, domainId]);
  broadcastSslLog(domainId, { status, log: trimmedLog });
};

const updateSslState = async (domainId, fields = {}) => {
  const updates = [];
  const params = [];

  if (Object.prototype.hasOwnProperty.call(fields, 'ssl_status')) {
    updates.push('ssl_status = ?');
    params.push(fields.ssl_status);
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'ssl_type')) {
    updates.push('ssl_type = ?');
    params.push(fields.ssl_type);
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'ssl_expires')) {
    updates.push('ssl_expires = ?');
    params.push(fields.ssl_expires);
  }
  if (Object.prototype.hasOwnProperty.call(fields, 'ssl_log')) {
    updates.push('ssl_log = ?');
    params.push(trimSslLog(fields.ssl_log));
  }

  if (updates.length === 0) return;

  params.push(domainId);
  await db.run(`UPDATE domains SET ${updates.join(', ')} WHERE id = ?`, params);

  const payload = {};
  if (Object.prototype.hasOwnProperty.call(fields, 'ssl_status')) payload.status = fields.ssl_status;
  if (Object.prototype.hasOwnProperty.call(fields, 'ssl_expires')) payload.expires = fields.ssl_expires;
  if (Object.prototype.hasOwnProperty.call(fields, 'ssl_log')) payload.log = trimSslLog(fields.ssl_log);
  broadcastSslLog(domainId, payload);
};

const isActiveBatchStatus = (status) => status === 'pending' || status === 'running';

const shellQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

const safeCertDirName = (domain) => {
  const safeName = String(domain || '').trim().replace(/[^a-zA-Z0-9.-]/g, '_');
  if (!safeName) {
    throw new Error('域名无效，无法保存证书');
  }
  return safeName;
};

const getLocalCertPaths = (domain) => {
  const safeName = safeCertDirName(domain);
  const dir = path.join(LOCAL_CERT_BASE_DIR, safeName);
  return {
    dir,
    cert: path.join(dir, `${safeName}.crt`),
    key: path.join(dir, `${safeName}.key`),
    fullchain: path.join(dir, `${safeName}.fullchain.crt`),
    metadata: path.join(dir, 'metadata.json')
  };
};

const fileExists = async (filePath) => {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch (err) {
    return false;
  }
};

const readTextIfExists = async (filePath) => {
  if (!(await fileExists(filePath))) return '';
  return fs.promises.readFile(filePath, 'utf8');
};

const getLocalCertInfo = async (domain) => {
  const localPaths = getLocalCertPaths(domain);
  const [hasFullchain, hasKey, hasCert, hasMetadata] = await Promise.all([
    fileExists(localPaths.fullchain),
    fileExists(localPaths.key),
    fileExists(localPaths.cert),
    fileExists(localPaths.metadata)
  ]);

  let metadata = null;
  if (hasMetadata) {
    try {
      metadata = JSON.parse(await fs.promises.readFile(localPaths.metadata, 'utf8'));
    } catch (err) {
      metadata = null;
    }
  }

  return {
    stored: hasFullchain && hasKey,
    dir: localPaths.dir,
    files: {
      fullchain: hasFullchain ? localPaths.fullchain : null,
      key: hasKey ? localPaths.key : null,
      cert: hasCert ? localPaths.cert : null
    },
    metadata
  };
};

const getLocalCertFileList = async (domain) => {
  const localPaths = getLocalCertPaths(domain);
  const specs = [
    { type: 'fullchain', label: '证书链', path: localPaths.fullchain },
    { type: 'key', label: '私钥', path: localPaths.key },
    { type: 'cert', label: '证书', path: localPaths.cert },
    { type: 'metadata', label: '元信息', path: localPaths.metadata }
  ];

  const files = [];
  for (const spec of specs) {
    try {
      const stat = await fs.promises.stat(spec.path);
      files.push({
        type: spec.type,
        label: spec.label,
        name: path.basename(spec.path),
        path: spec.path,
        size: stat.size,
        modified_at: formatTime(stat.mtime)
      });
    } catch (err) {
      files.push({
        type: spec.type,
        label: spec.label,
        name: path.basename(spec.path),
        path: spec.path,
        size: 0,
        modified_at: null,
        missing: true
      });
    }
  }

  return files;
};

const writeRemoteFile = async (sshService, remotePath, content, mode = '644') => {
  const result = await sshService.exec(`printf %s ${shellQuote(content)} | sudo tee ${shellQuote(remotePath)} >/dev/null`);
  if (!result.success) {
    throw new Error(result.output || `写入远程文件失败: ${remotePath}`);
  }
  const chmodResult = await sshService.exec(`sudo chmod ${shellQuote(mode)} ${shellQuote(remotePath)}`);
  if (!chmodResult.success) {
    throw new Error(chmodResult.output || `设置远程文件权限失败: ${remotePath}`);
  }
};

const readRemoteFile = async (sshService, remotePath) => {
  const result = await sshService.exec(`cat ${shellQuote(remotePath)} 2>/dev/null || true`);
  return result.output?.trim() || '';
};

const saveCertToLocal = async (domain, sshService, sourceServer, expiresAt = null) => {
  const remotePaths = sslCert.getCertPath(domain);
  const localPaths = getLocalCertPaths(domain);

  const [fullchainContent, keyContent, certContent] = await Promise.all([
    readRemoteFile(sshService, remotePaths.fullchain),
    readRemoteFile(sshService, remotePaths.key),
    readRemoteFile(sshService, remotePaths.cert)
  ]);

  if (!fullchainContent || !keyContent) {
    throw new Error('远程证书文件不完整，未保存到本地');
  }

  await fs.promises.mkdir(localPaths.dir, { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(localPaths.fullchain, `${fullchainContent}\n`, { mode: 0o644 });
  await fs.promises.writeFile(localPaths.key, `${keyContent}\n`, { mode: 0o600 });
  if (certContent) {
    await fs.promises.writeFile(localPaths.cert, `${certContent}\n`, { mode: 0o644 });
  }

  const metadata = {
    domain,
    saved_at: formatTime(),
    source_server: sourceServer,
    expires: expiresAt,
    remote_paths: remotePaths
  };
  await fs.promises.writeFile(localPaths.metadata, JSON.stringify(metadata, null, 2), { mode: 0o600 });
  await Promise.allSettled([
    fs.promises.chmod(localPaths.dir, 0o700),
    fs.promises.chmod(localPaths.key, 0o600),
    fs.promises.chmod(localPaths.metadata, 0o600)
  ]);

  return {
    stored: true,
    dir: localPaths.dir,
    files: {
      fullchain: localPaths.fullchain,
      key: localPaths.key,
      cert: certContent ? localPaths.cert : null
    },
    metadata
  };
};

const getServerLabel = (server) => `${server.name || server.ip} (${server.ip})`;

const getDefaultServer = async (userId = null) => {
  const where = userId ? 'WHERE user_id = ? AND (status IS NULL OR status != ?)' : 'WHERE (status IS NULL OR status != ?)';
  const params = userId ? [userId, 'disabled'] : ['disabled'];
  return db.get(`
    SELECT * FROM servers
    ${where}
    ORDER BY is_default DESC, id ASC
    LIMIT 1
  `, params);
};

const getServerById = async (serverId) => {
  if (!serverId) return null;
  const id = parseInt(serverId, 10);
  if (!Number.isInteger(id) || id <= 0) return null;
  return db.get('SELECT * FROM servers WHERE id = ? AND (status IS NULL OR status != ?)', [id, 'disabled']);
};

const getSshService = (server) => {
  return new SshFtpService({
    ip: server.ip,
    port: server.port,
    username: server.username,
    password: server.password
  });
};

const hasIssueSucceeded = (result) => (
  result.success ||
  result.output?.includes('Cert success') ||
  result.output?.includes('Installing cert') ||
  result.output?.includes('Your cert is in')
);

const createBatchJob = async (user) => {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const now = formatTime();
  
  // 保存到数据库 - 确保所有字段都有值
  await db.run(`
    INSERT INTO batch_ssl_jobs (job_id, user_id, status, total, done, success, failed, log, results, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, user.id, 'pending', 0, 0, 0, 0, '', '[]', now, now]);
  
  const job = {
    id,
    user_id: user.id,
    role: user.role,
    status: 'pending',
    total: 0,
    done: 0,
    success: 0,
    failed: 0,
    log: '',
    results: [],
    created_at: now,
    updated_at: now,
    started_at: null,
    finished_at: null
  };
  
  batchIssueJobs.set(id, job);
  return job;
};

const updateBatchJob = async (job) => {
  job.updated_at = formatTime();
  
  // 更新数据库 - 确保所有undefined转换为null
  await db.run(`
    UPDATE batch_ssl_jobs 
    SET status = ?, total = ?, done = ?, success = ?, failed = ?, log = ?, results = ?, updated_at = ?, started_at = ?, finished_at = ?
    WHERE job_id = ?
  `, [
    job.status || 'pending',
    job.total || 0,
    job.done || 0,
    job.success || 0,
    job.failed || 0,
    trimSslLog(job.log || ''),
    JSON.stringify(job.results || []),
    job.updated_at,
    job.started_at || null,
    job.finished_at || null,
    job.id
  ]);
  
  // 更新内存
  batchIssueJobs.set(job.id, job);
};

const appendBatchJobLog = async (job, message = '') => {
  job.log = trimSslLog(`${job.log}${message}`);
  await updateBatchJob(job);
};

const cleanupBatchJobs = () => {
  const now = Date.now();
  for (const [id, job] of batchIssueJobs.entries()) {
    if (job.finished_at_ms && now - job.finished_at_ms > BATCH_JOB_TTL_MS) {
      batchIssueJobs.delete(id);
    }
  }
};

const fetchBatchDomains = async (user, domainIds = []) => {
  const ids = [...new Set((Array.isArray(domainIds) ? domainIds : [])
    .map(id => parseInt(id, 10))
    .filter(id => Number.isInteger(id) && id > 0))];
  const userClause = user.role === 'admin' ? '' : ' AND d.user_id = ?';
  const userParams = user.role === 'admin' ? [] : [user.id];

  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    return db.all(`
      SELECT d.*, a.access_key, a.secret_key, a.platform
      FROM domains d
      LEFT JOIN aliyun_config a ON d.aliyun_config_id = a.id
      WHERE d.id IN (${placeholders}) AND (d.status IS NULL OR d.status != 'disabled')${userClause}
      ORDER BY d.id ASC
    `, [...ids, ...userParams]);
  }

  return db.all(`
    SELECT d.*, a.access_key, a.secret_key, a.platform
    FROM domains d
    LEFT JOIN aliyun_config a ON d.aliyun_config_id = a.id
    WHERE (d.status IS NULL OR d.status != 'disabled')${userClause}
    ORDER BY d.id ASC
  `, userParams);
};

const issueDomainForBatch = async (domain, certType, job) => {
  let log = `[${formatTime()}] 开始申请证书\n`;
  const cert_type = certType || 'letsencrypt';
  const verify_method = 'dns';
  const isWildcard = true;

  log += `[${formatTime()}] 域名: ${domain.domain}, *.${domain.domain}\n`;
  log += `[${formatTime()}] 证书类型: ${cert_type}\n`;
  log += `[${formatTime()}] 验证方式: DNS验证\n`;

  if (!domain.aliyun_config_id || !domain.access_key) {
    log += `[${formatTime()}] 错误: 通配符证书需要DNS平台配置\n`;
    await updateSslStatusLog(domain.id, 'error', log);
    return { domain: domain.domain, success: false, message: '缺少DNS平台配置', log: trimSslLog(log) };
  }

  const server = await getDefaultServer(domain.user_id);
  if (!server || !server.ip) {
    log += `[${formatTime()}] 错误: 没有可用的默认服务器\n`;
    await updateSslStatusLog(domain.id, 'error', log);
    return { domain: domain.domain, success: false, message: '没有可用的默认服务器', log: trimSslLog(log) };
  }

  const serverLabel = getServerLabel(server);
  log += `[${formatTime()}] 签发服务器: ${serverLabel}${server.is_default ? '（默认）' : '（自动选择）'}\n`;
  log += `[${formatTime()}] 状态: 申请中...\n`;
  await updateSslState(domain.id, {
    ssl_status: 'issuing',
    ssl_type: cert_type,
    ssl_log: log
  });

  const issueCmd = sslCert.getIssueWildcardCommand(
    domain.domain,
    cert_type,
    domain.platform || 'aliyun',
    domain.access_key,
    domain.secret_key
  );

  const sshService = getSshService(server);

  const checkAcmeCmd = 'if [ -f ~/.acme.sh/acme.sh ]; then echo "ACME_INSTALLED"; else echo "ACME_NOT_INSTALLED"; fi';
  const checkResult = await sshService.exec(checkAcmeCmd);
  if (checkResult.output?.includes('ACME_NOT_INSTALLED')) {
    log += `[${formatTime()}] ${serverLabel}: 检测到未安装acme.sh，正在自动安装...\n`;
    await updateSslLog(domain.id, log);

    const installCmd = sslCert.getInstallAcmeCommand('admin@' + domain.domain);
    const installResult = await sshService.exec(installCmd, SSL_INSTALL_TIMEOUT_MS);
    if (installResult.code === -1 || installResult.output?.includes('[命令执行超时]')) {
      log += `[${formatTime()}] ${serverLabel}: acme.sh安装超时\n`;
      log += `--- 安装输出 ---\n${trimCommandOutput(installResult.output || '(无输出)')}\n--- 输出结束 ---\n`;
      await updateSslStatusLog(domain.id, 'error', log);
      return { domain: domain.domain, success: false, message: 'acme.sh安装超时', log: trimSslLog(log) };
    }
    if (!installResult.success && !installResult.output?.includes('acme.sh')) {
      log += `[${formatTime()}] ${serverLabel}: acme.sh安装失败\n`;
      log += `--- 安装输出 ---\n${trimCommandOutput(installResult.output || '(无输出)')}\n--- 输出结束 ---\n`;
      await updateSslStatusLog(domain.id, 'error', log);
      return { domain: domain.domain, success: false, message: 'acme.sh安装失败', log: trimSslLog(log) };
    }

    log += `[${formatTime()}] ${serverLabel}: acme.sh安装成功\n`;
    await updateSslLog(domain.id, log);
  }

  log += `[${formatTime()}] ${serverLabel}: 执行申请命令...\n`;
  await updateSslLog(domain.id, log);

  const result = await sshService.exec(issueCmd, SSL_ISSUE_TIMEOUT_MS);
  log += `[${formatTime()}] ${serverLabel}: 命令执行完成\n`;
  log += `--- 执行输出 ---\n${trimCommandOutput(result.output || '(无输出)')}\n--- 输出结束 ---\n`;

  if (result.code === -1 || result.output?.includes('[命令执行超时]')) {
    log += `[${formatTime()}] ${serverLabel}: 证书申请超时，已跳过该域名继续后续任务\n`;
    await updateSslStatusLog(domain.id, 'error', log);
    return { domain: domain.domain, success: false, message: '证书申请超时', log: trimSslLog(log) };
  }

  if (!hasIssueSucceeded(result)) {
    log += `[${formatTime()}] ${serverLabel}: 证书申请失败\n`;
    await updateSslStatusLog(domain.id, 'error', log);
    return { domain: domain.domain, success: false, message: '证书申请失败', log: trimSslLog(log) };
  }

  const checkCmd = sslCert.getCheckCommand(domain.domain);
  const certCheckResult = await sshService.exec(checkCmd);
  let expiresAt = null;
  const afterMatch = certCheckResult.output?.match(/notAfter=(.+)/);
  if (afterMatch) {
    expiresAt = parseOpenSSLDate(afterMatch[1].trim());
  }

  log += `[${formatTime()}] ${serverLabel}: 证书申请成功\n`;
  log += `[${formatTime()}] ${serverLabel}: 过期时间: ${expiresAt || '未知'}\n`;

  let localCert = await getLocalCertInfo(domain.domain);
  try {
    localCert = await saveCertToLocal(domain.domain, sshService, serverLabel, expiresAt);
    log += `[${formatTime()}] ${serverLabel}: 证书已保存到本地文件存储: ${localCert.dir}\n`;
  } catch (err) {
    log += `[${formatTime()}] ${serverLabel}: 本地保存证书失败: ${err.message}\n`;
  }

  log += `[${formatTime()}] 证书申请成功!\n`;
  await updateSslState(domain.id, {
    ssl_status: 'active',
    ssl_expires: expiresAt,
    ssl_log: log
  });

  return {
    domain: domain.domain,
    success: true,
    message: isWildcard ? `通配符证书申请成功 (*.${domain.domain})` : `证书申请成功 (${domain.domain})`,
    expires: expiresAt,
    local_cert: localCert,
    log: trimSslLog(log)
  };
};

const runBatchIssueJob = async (job, domains, options = {}) => {
  job.status = 'running';
  job.total = domains.length;
  job.started_at = formatTime();
  await appendBatchJobLog(job, `[${formatTime()}] 批量获取证书开始，共 ${domains.length} 个域名\n`);

  for (const domain of domains) {
    await appendBatchJobLog(job, `\n========== ${domain.domain} ==========\n`);
    try {
      const result = await issueDomainForBatch(domain, options.cert_type, job);
      job.results.push(result);
      if (result.success) {
        job.success += 1;
        await appendBatchJobLog(job, `[${formatTime()}] ${domain.domain}: 成功，过期时间 ${result.expires || '未知'}\n`);
      } else {
        job.failed += 1;
        await appendBatchJobLog(job, `[${formatTime()}] ${domain.domain}: 失败，${result.message || '未知错误'}\n`);
      }
      await appendBatchJobLog(job, `${result.log || ''}\n`);
    } catch (err) {
      const message = err.message || '未知错误';
      job.failed += 1;
      job.results.push({ domain: domain.domain, success: false, message });
      await appendBatchJobLog(job, `[${formatTime()}] ${domain.domain}: 异常失败，${message}\n`);
      try {
        await updateSslStatusLog(domain.id, 'error', `[${formatTime()}] 批量申请异常: ${message}\n`);
      } catch (saveErr) {
        console.error('[SSL Batch] 保存域名异常状态失败:', saveErr.message);
      }
    }
    job.done += 1;
    await updateBatchJob(job);
  }

  job.status = job.failed > 0 ? 'completed_with_errors' : 'completed';
  job.finished_at = formatTime();
  job.finished_at_ms = Date.now();
  await appendBatchJobLog(job, `\n[${formatTime()}] 批量获取证书完成：成功 ${job.success} 个，失败 ${job.failed} 个\n`);
};

router.use(authMiddleware);

// 获取证书类型列表
router.get('/types', (req, res) => {
  res.json(sslCert.CERT_TYPES);
});

// 获取验证方式列表
router.get('/verify-methods', (req, res) => {
  res.json(sslCert.VERIFY_METHODS);
});

// 检查主域名证书状态
router.get('/status/:domain_id', async (req, res) => {
  try {
    const domain = await db.get(`
      SELECT d.*, a.access_key, a.secret_key, a.platform
      FROM domains d
      LEFT JOIN aliyun_config a ON d.aliyun_config_id = a.id
      WHERE d.id = ?
    `, [req.params.domain_id]);

    if (!domain) {
      return res.status(404).json({ error: '域名不存在' });
    }

    const server = await getDefaultServer(domain.user_id);

    const paths = sslCert.getCertPath(domain.domain);
    const localCert = await getLocalCertInfo(domain.domain);
    const hasServer = !!server?.ip;

    if (!hasServer) {
      return res.json({
        exists: false,
        domain: domain.domain,
        paths,
        ssl_status: domain.ssl_status,
        ssl_type: domain.ssl_type,
        ssl_expires: domain.ssl_expires,
        ssl_log: domain.ssl_log,
        has_server: false,
        local_cert: localCert,
        has_dns_config: !!domain.aliyun_config_id,
        platform: domain.platform
      });
    }

    let exists = !!localCert.stored;
    let notBefore = null, notAfter = localCert.metadata?.expires || null, issuer = null, san = null;
    let statusSource = localCert.stored ? 'local' : 'remote';

    try {
      const sshService = getSshService(server);
      const checkCmd = sslCert.getCheckCommand(domain.domain);
      const result = await sshService.exec(checkCmd);

      const output = result.output || '';
      exists = output.includes('CERT_EXISTS=true');
      statusSource = 'remote';

      if (exists) {
        const beforeMatch = output.match(/notBefore=(.+)/);
        const afterMatch = output.match(/notAfter=(.+)/);
        const issuerMatch = output.match(/issuer=(.+)/);
        const sanMatch = output.match(/DNS:([^\n]+)/);

        if (beforeMatch) notBefore = parseOpenSSLDate(beforeMatch[1].trim());
        if (afterMatch) notAfter = parseOpenSSLDate(afterMatch[1].trim());
        if (issuerMatch) issuer = issuerMatch[1].trim();
        if (sanMatch) san = sanMatch[1].trim();
      }
    } catch (err) {
      if (!localCert.stored) {
        throw err;
      }
    }

    res.json({
      exists,
      domain: domain.domain,
      wildcard: `*.${domain.domain}`,
      not_before: notBefore,
      not_after: notAfter,
      issuer,
      san,
      paths,
      ssl_status: domain.ssl_status,
      ssl_type: domain.ssl_type,
      ssl_expires: domain.ssl_expires,
      ssl_log: domain.ssl_log,
      has_server: true,
      status_source: statusSource,
      local_cert: localCert,
      has_dns_config: !!domain.aliyun_config_id,
      platform: domain.platform
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取可用服务器列表（用于发布证书）
router.get('/servers', async (req, res) => {
  try {
    const servers = await db.all('SELECT id, name, ip, is_default FROM servers WHERE status IS NULL OR status != ? ORDER BY is_default DESC, id ASC', ['disabled']);
    res.json(servers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取证书申请日志（用于实时轮询）
router.get('/log/:domain_id', async (req, res) => {
  try {
    const domain = await db.get('SELECT ssl_log, ssl_status FROM domains WHERE id = ?', [req.params.domain_id]);
    if (!domain) {
      return res.status(404).json({ error: '域名不存在' });
    }
    res.json({ log: domain.ssl_log || '', status: domain.ssl_status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 批量后台获取证书
router.post('/batch-issue', async (req, res) => {
  try {
    cleanupBatchJobs();
    const { domain_ids, cert_type } = req.body;
    const domains = await fetchBatchDomains(req.user, domain_ids);

    if (domains.length === 0) {
      return res.status(400).json({ error: '没有可获取证书的域名' });
    }

    const job = await createBatchJob(req.user);
    job.total = domains.length;
    // 存储 cert_type 到数据库
    await db.run('UPDATE batch_ssl_jobs SET cert_type = ? WHERE job_id = ?', [cert_type || 'letsencrypt', job.id]);
    await appendBatchJobLog(job, `[${formatTime()}] 已创建批量证书任务，等待后台执行\n`);

    setImmediate(() => {
      runBatchIssueJob(job, domains, { cert_type }).catch(err => {
        job.status = 'error';
        job.finished_at = formatTime();
        job.finished_at_ms = Date.now();
        appendBatchJobLog(job, `[${formatTime()}] 批量任务异常: ${err.message}\n`);
        console.error('[SSL Batch] 批量任务异常:', err);
      });
    });

    res.json({
      success: true,
      job_id: job.id,
      total: domains.length,
      message: `已开始后台获取 ${domains.length} 个域名证书`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取批量证书任务日志
router.get('/batch-issue/:job_id', async (req, res) => {
  try {
    cleanupBatchJobs();
    
    // 先从内存查找
    let job = batchIssueJobs.get(req.params.job_id);
    
    // 如果内存中没有，从数据库加载
    if (!job) {
      const dbJob = await db.get('SELECT * FROM batch_ssl_jobs WHERE job_id = ?', [req.params.job_id]);
      if (!dbJob) {
        return res.status(404).json({ error: '批量任务不存在或已过期' });
      }
      
      // 检查权限
      if (req.user.role !== 'admin' && dbJob.user_id !== req.user.id) {
        return res.status(403).json({ error: '无权查看该任务' });
      }
      
      // 数据库里的 running/pending 任务在进程重启后已经没有后台执行器，不能当作仍在运行。
      const orphanedActiveJob = isActiveBatchStatus(dbJob.status);

      // 从数据库恢复任务到内存
      job = {
        id: dbJob.job_id,
        user_id: dbJob.user_id,
        role: req.user.role,
        status: orphanedActiveJob ? 'error' : dbJob.status,
        total: dbJob.total,
        done: dbJob.done,
        success: dbJob.success,
        failed: orphanedActiveJob && Number(dbJob.failed || 0) === 0 ? 1 : dbJob.failed,
        log: orphanedActiveJob
          ? `${dbJob.log || ''}\n[${formatTime()}] 批量任务已中断：后端服务曾重启，后台签发进程已丢失，请重新发起未完成域名。\n`
          : dbJob.log || '',
        results: JSON.parse(dbJob.results || '[]'),
        created_at: dbJob.created_at,
        updated_at: dbJob.updated_at,
        started_at: dbJob.started_at,
        finished_at: orphanedActiveJob ? formatTime() : dbJob.finished_at
      };

      if (orphanedActiveJob) {
        job.finished_at_ms = Date.now();
        await updateBatchJob(job);
      }
      
      batchIssueJobs.set(job.id, job);
    } else {
      // 检查权限
      if (req.user.role !== 'admin' && job.user_id !== req.user.id) {
        return res.status(403).json({ error: '无权查看该任务' });
      }
    }

    res.json({
      id: job.id,
      status: job.status,
      total: job.total,
      done: job.done,
      success: job.success,
      failed: job.failed,
      log: job.log,
      results: job.results,
      created_at: job.created_at,
      updated_at: job.updated_at,
      started_at: job.started_at,
      finished_at: job.finished_at
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 重试批量证书任务（从失败位置继续 / 仅失败项 / 全部重新执行）
router.post('/batch-issue/:job_id/retry', async (req, res) => {
  try {
    const { mode = 'remaining', cert_type } = req.body;
    // mode: 'remaining' = 从中断位置继续未完成的, 'failed' = 仅重试失败的, 'all' = 全部重新执行
    
    // 从数据库加载原任务
    const dbJob = await db.get('SELECT * FROM batch_ssl_jobs WHERE job_id = ?', [req.params.job_id]);
    if (!dbJob) {
      return res.status(404).json({ error: '原任务不存在或已过期' });
    }
    
    // 检查权限
    if (req.user.role !== 'admin' && dbJob.user_id !== req.user.id) {
      return res.status(403).json({ error: '无权操作该任务' });
    }
    
    // 解析原任务的结果
    const oldResults = JSON.parse(dbJob.results || '[]');
    const successDomains = new Set(oldResults.filter(r => r.success).map(r => r.domain));
    const failedDomainNames = oldResults.filter(r => !r.success).map(r => r.domain);
    
    // 获取原任务涉及的所有域名（从数据库重新查询）
    let domainIds = [];
    
    if (mode === 'failed') {
      // 仅重试失败的域名
      if (failedDomainNames.length === 0) {
        return res.status(400).json({ error: '没有失败的域名需要重试' });
      }
      const placeholders = failedDomainNames.map(() => '?').join(',');
      const failedDomains = await db.all(`
        SELECT d.*, a.access_key, a.secret_key, a.platform
        FROM domains d
        LEFT JOIN aliyun_config a ON d.aliyun_config_id = a.id
        WHERE d.domain IN (${placeholders})
      `, failedDomainNames);
      domainIds = failedDomains.map(d => d.id);
    } else if (mode === 'remaining') {
      // 从中断位置继续：重试失败的 + 未处理的
      // 未处理的 = 原任务 total > done 的部分，即不在 results 中的域名
      // 需要知道原任务的所有域名ID，但数据库中没有存储 domain_ids
      // 所以我们用 results 中已成功的域名来排除
      // 获取所有域名，排除已成功的
      const allDomains = await fetchBatchDomains(req.user);
      const retryDomains = allDomains.filter(d => !successDomains.has(d.domain));
      
      if (retryDomains.length === 0) {
        return res.status(400).json({ error: '所有域名都已成功，无需重试' });
      }
      domainIds = retryDomains.map(d => d.id);
    } else {
      // all: 全部重新执行 - 获取原任务涉及的所有域名
      const allDomainNames = oldResults.map(r => r.domain);
      if (allDomainNames.length > 0) {
        const placeholders = allDomainNames.map(() => '?').join(',');
        const allDomains = await db.all(`
          SELECT d.*, a.access_key, a.secret_key, a.platform
          FROM domains d
          LEFT JOIN aliyun_config a ON d.aliyun_config_id = a.id
          WHERE d.domain IN (${placeholders})
        `, allDomainNames);
        domainIds = allDomains.map(d => d.id);
      }
      
      if (domainIds.length === 0) {
        // 如果无法从结果中恢复，获取所有域名
        const allDomains = await fetchBatchDomains(req.user);
        domainIds = allDomains.map(d => d.id);
      }
    }
    
    // 获取要处理的域名
    const domains = await fetchBatchDomains(req.user, domainIds);
    if (domains.length === 0) {
      return res.status(400).json({ error: '没有可重试的域名' });
    }
    
    // 创建新的批量任务
    const job = await createBatchJob(req.user);
    job.total = domains.length;
    
    const modeText = mode === 'failed' ? '仅失败项' : mode === 'remaining' ? '从中断位置继续' : '全部重新执行';
    await appendBatchJobLog(job, `[${formatTime()}] 重试任务已创建（${modeText}），原任务: ${req.params.job_id}\n`);
    await appendBatchJobLog(job, `[${formatTime()}] 待处理域名: ${domains.length} 个\n`);
    
    const useCertType = cert_type || dbJob.cert_type || 'letsencrypt';
    
    setImmediate(() => {
      runBatchIssueJob(job, domains, { cert_type: useCertType }).catch(err => {
        job.status = 'error';
        job.finished_at = formatTime();
        job.finished_at_ms = Date.now();
        appendBatchJobLog(job, `[${formatTime()}] 批量任务异常: ${err.message}\n`);
        console.error('[SSL Batch] 重试任务异常:', err);
      });
    });
    
    res.json({
      success: true,
      job_id: job.id,
      total: domains.length,
      mode,
      message: `已开始重试 ${domains.length} 个域名（${modeText}）`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取用户的所有批量任务列表
router.get('/batch-jobs', async (req, res) => {
  try {
    const { limit = 10, status } = req.query;
    const userId = req.user.role === 'admin' ? null : req.user.id;
    
    let sql = 'SELECT * FROM batch_ssl_jobs';
    const params = [];
    const conditions = [];
    
    if (userId) {
      conditions.push('user_id = ?');
      params.push(userId);
    }
    
    if (status) {
      conditions.push('status = ?');
      params.push(status);
    }
    
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(parseInt(limit));
    
    const jobs = await db.all(sql, params);
    
    res.json(jobs.map(job => ({
      job_id: job.job_id,
      status: job.status,
      total: job.total,
      done: job.done,
      success: job.success,
      failed: job.failed,
      created_at: job.created_at,
      updated_at: job.updated_at,
      started_at: job.started_at,
      finished_at: job.finished_at
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除批量任务
router.delete('/batch-issue/:job_id', async (req, res) => {
  try {
    const dbJob = await db.get('SELECT * FROM batch_ssl_jobs WHERE job_id = ?', [req.params.job_id]);
    if (!dbJob) {
      return res.status(404).json({ error: '任务不存在' });
    }
    
    // 检查权限
    if (req.user.role !== 'admin' && dbJob.user_id !== req.user.id) {
      return res.status(403).json({ error: '无权操作该任务' });
    }
    
    // 不允许删除运行中的任务
    if (isActiveBatchStatus(dbJob.status)) {
      // 检查内存中的任务是否真的还在跑
      const memJob = batchIssueJobs.get(req.params.job_id);
      if (memJob && isActiveBatchStatus(memJob.status)) {
        return res.status(400).json({ error: '任务正在运行中，请先等待完成' });
      }
    }
    
    await db.run('DELETE FROM batch_ssl_jobs WHERE job_id = ?', [req.params.job_id]);
    batchIssueJobs.delete(req.params.job_id);
    
    res.json({ success: true, message: '任务已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 清空已完成的批量任务
router.delete('/batch-jobs/clear', async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? null : req.user.id;
    
    let sql = `DELETE FROM batch_ssl_jobs WHERE status IN ('completed', 'completed_with_errors', 'error')`;
    const params = [];
    
    if (userId) {
      sql += ' AND user_id = ?';
      params.push(userId);
    }
    
    const result = await db.run(sql, params);
    
    // 同步清理内存
    for (const [id, job] of batchIssueJobs.entries()) {
      if (!isActiveBatchStatus(job.status)) {
        batchIssueJobs.delete(id);
      }
    }
    
    res.json({ success: true, message: `已清空已完成任务`, count: result.changes || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 申请证书
router.post('/issue/:domain_id', async (req, res) => {
  const startTime = formatTime();
  let log = `[${startTime}] 开始申请证书\n`;
  try {
    const { cert_type, verify_method, webroot } = req.body;

    const domain = await db.get(`
      SELECT d.*, a.access_key, a.secret_key, a.platform
      FROM domains d
      LEFT JOIN aliyun_config a ON d.aliyun_config_id = a.id
      WHERE d.id = ?
    `, [req.params.domain_id]);

    if (!domain) {
      return res.status(404).json({ error: '域名不存在' });
    }

    const isWildcard = verify_method !== 'http' && verify_method !== 'standalone';
    log += `[${startTime}] 域名: ${domain.domain}${isWildcard ? ', *.' + domain.domain : ''}\n`;
    log += `[${startTime}] 证书类型: ${cert_type || 'letsencrypt'}\n`;
    log += `[${startTime}] 验证方式: ${verify_method || 'dns'}\n`;

    // DNS验证需要DNS配置
    if (isWildcard && (!domain.aliyun_config_id || !domain.access_key)) {
      log += `[${startTime}] 错误: 通配符证书需要DNS平台配置\n`;
      await updateSslLog(req.params.domain_id, log);
      return res.status(400).json({
        error: '通配符证书必须使用DNS验证，请先为该域名配置DNS平台',
        log
      });
    }

    const server = await getDefaultServer(domain.user_id);

    if (!server || !server.ip) {
      log += `[${startTime}] 错误: 没有可用的服务器\n`;
      await updateSslLog(req.params.domain_id, log);
      return res.status(400).json({ error: '请先添加服务器，或设置一台默认服务器', log });
    }

    const serverLabel = getServerLabel(server);
    log += `[${startTime}] 签发服务器: ${serverLabel}${server.is_default ? '（默认）' : '（自动选择）'}\n`;

    // 更新状态为申请中
    log += `[${formatTime()}] 状态: 申请中...\n`;
    await updateSslState(req.params.domain_id, {
      ssl_status: 'issuing',
      ssl_type: cert_type || 'letsencrypt',
      ssl_log: log
    });

    // 根据验证方式生成命令
    let issueCmd;
    if (verify_method === 'http') {
      log += `[${formatTime()}] 使用HTTP验证（仅主域名，不支持通配符）\n`;
      issueCmd = sslCert.getIssueHttpCommand(domain.domain, cert_type, webroot);
    } else if (verify_method === 'standalone') {
      log += `[${formatTime()}] 使用Standalone验证（会临时停止nginx）\n`;
      issueCmd = sslCert.getIssueStandaloneCommand(domain.domain, cert_type);
    } else {
      log += `[${formatTime()}] 使用DNS验证（支持通配符）\n`;
      log += `[${formatTime()}] DNS平台: ${domain.platform || 'aliyun'}\n`;
      issueCmd = sslCert.getIssueWildcardCommand(
        domain.domain,
        cert_type,
        domain.platform || 'aliyun',
        domain.access_key,
        domain.secret_key
      );
    }

    log += `[${formatTime()}] 将在默认服务器上执行acme.sh申请命令\n`;
    await updateSslLog(req.params.domain_id, log);

    const paths = sslCert.getCertPath(domain.domain);
    let expiresAt = null;
    let localCert = await getLocalCertInfo(domain.domain);

    let result = null;
    try {
      const sshService = getSshService(server);

      // 先检查并安装 acme.sh
      const checkAcmeCmd = 'if [ -f ~/.acme.sh/acme.sh ]; then echo "ACME_INSTALLED"; else echo "ACME_NOT_INSTALLED"; fi';
      const checkResult = await sshService.exec(checkAcmeCmd);

      if (checkResult.output?.includes('ACME_NOT_INSTALLED')) {
        log += `[${formatTime()}] ${serverLabel}: 检测到未安装acme.sh，正在自动安装...\n`;
        await updateSslLog(req.params.domain_id, log);

        const installCmd = sslCert.getInstallAcmeCommand('admin@' + domain.domain);
        const installResult = await sshService.exec(installCmd);

        if (!installResult.success && !installResult.output?.includes('acme.sh')) {
          log += `[${formatTime()}] ${serverLabel}: acme.sh安装失败\n`;
          log += `--- ${serverLabel} 安装输出 ---\n${installResult.output || '(无输出)'}\n--- 输出结束 ---\n`;
          await updateSslLog(req.params.domain_id, log);
          await updateSslStatusLog(req.params.domain_id, 'error', log);
          return res.json({
            success: false,
            message: 'acme.sh安装失败',
            log: trimSslLog(log)
          });
        }

        log += `[${formatTime()}] ${serverLabel}: acme.sh安装成功\n`;
        await updateSslLog(req.params.domain_id, log);
      }

      log += `[${formatTime()}] ${serverLabel}: 执行申请命令...\n`;
      await updateSslLog(req.params.domain_id, log);

      result = await sshService.exec(issueCmd);

      log += `[${formatTime()}] ${serverLabel}: 命令执行完成\n`;
      log += `--- ${serverLabel} 执行输出 ---\n${result.output || '(无输出)'}\n--- 输出结束 ---\n`;

      if (hasIssueSucceeded(result)) {
        // 获取证书信息
        const checkCmd = sslCert.getCheckCommand(domain.domain);
        const certCheckResult = await sshService.exec(checkCmd);

        const afterMatch = certCheckResult.output?.match(/notAfter=(.+)/);
        if (afterMatch && !expiresAt) {
          expiresAt = parseOpenSSLDate(afterMatch[1].trim());
        }

        log += `[${formatTime()}] ${serverLabel}: 证书申请成功\n`;
        log += `[${formatTime()}] ${serverLabel}: 过期时间: ${expiresAt || '未知'}\n`;

        try {
          localCert = await saveCertToLocal(domain.domain, sshService, serverLabel, expiresAt);
          log += `[${formatTime()}] ${serverLabel}: 证书已保存到本地文件存储: ${localCert.dir}\n`;
        } catch (err) {
          log += `[${formatTime()}] ${serverLabel}: 本地保存证书失败: ${err.message}\n`;
        }

        log += `\n[${formatTime()}] 证书申请成功!\n`;
        await updateSslState(req.params.domain_id, {
          ssl_status: 'active',
          ssl_expires: expiresAt,
          ssl_log: log
        });

        return res.json({
          success: true,
          message: isWildcard ? `通配符证书申请成功 (*.${domain.domain})` : `证书申请成功 (${domain.domain})`,
          paths,
          issue_server: { id: server.id, name: server.name, ip: server.ip, is_default: server.is_default },
          local_cert: localCert,
          expires: expiresAt,
          log: trimSslLog(log)
        });
      }

      log += `[${formatTime()}] ${serverLabel}: 证书申请失败\n`;
      await updateSslStatusLog(req.params.domain_id, 'error', log);
      return res.json({
        success: false,
        message: '证书申请失败，请查看日志',
        output: result.output,
        local_cert: localCert,
        log: trimSslLog(log)
      });
    } catch (err) {
      log += `[${formatTime()}] ${serverLabel}: 异常错误: ${err.message}\n`;
      await updateSslStatusLog(req.params.domain_id, 'error', log);
      return res.status(500).json({ error: err.message, log: trimSslLog(log) });
    }
  } catch (err) {
    log += `[${formatTime()}] 异常错误: ${err.message}\n`;
    try {
      await updateSslStatusLog(req.params.domain_id, 'error', log);
    } catch (saveErr) {
      console.error('[SSL] 保存异常日志失败:', saveErr.message);
    }
    console.error('[SSL] 申请证书异常:', err);
    res.status(500).json({ error: err.message, log: trimSslLog(log) });
  }
});

// 续期证书
router.post('/renew/:domain_id', async (req, res) => {
  const startTime = formatTime();
  let log = `[${startTime}] 开始续期证书\n`;
  try {

    const domain = await db.get('SELECT * FROM domains WHERE id = ?', [req.params.domain_id]);

    if (!domain) {
      return res.status(404).json({ error: '域名不存在' });
    }

    log += `[${startTime}] 域名: ${domain.domain}\n`;

    const server = await getDefaultServer(domain.user_id);

    if (!server || !server.ip) {
      log += `[${startTime}] 错误: 没有可用的服务器\n`;
      await updateSslLog(req.params.domain_id, log);
      return res.status(400).json({ error: '请先添加服务器，或设置一台默认服务器', log });
    }

    log += `[${startTime}] 续期服务器: ${getServerLabel(server)}${server.is_default ? '（默认）' : '（自动选择）'}\n`;

    const sshService = getSshService(server);

    log += `[${formatTime()}] 状态: 续期中...\n`;
    await updateSslStatusLog(req.params.domain_id, 'renewing', log);

    // 检查是否是通配符证书
    const checkCmd = sslCert.getCheckCommand(domain.domain);
    const checkResult = await sshService.exec(checkCmd);
    const isWildcard = checkResult.output?.includes(`*.${domain.domain}`);

    const renewCmd = sslCert.getRenewCommand(domain.domain, isWildcard);
    const result = await sshService.exec(renewCmd);

    log += `[${formatTime()}] 命令执行完成\n`;
    log += `--- 执行输出 ---\n${result.output || '(无输出)'}\n--- 输出结束 ---\n`;

    if (result.success || result.output?.includes('Cert success') || result.output?.includes('Renew success')) {
      const newCheckResult = await sshService.exec(checkCmd);

      let expiresAt = null;
      const afterMatch = newCheckResult.output?.match(/notAfter=(.+)/);
      if (afterMatch) {
        expiresAt = parseOpenSSLDate(afterMatch[1].trim());
      }

      log += `[${formatTime()}] 证书续期成功!\n`;
      log += `[${formatTime()}] 新过期时间: ${expiresAt || '未知'}\n`;
      let localCert = await getLocalCertInfo(domain.domain);
      try {
        localCert = await saveCertToLocal(domain.domain, sshService, getServerLabel(server), expiresAt);
        log += `[${formatTime()}] 证书已保存到本地文件存储: ${localCert.dir}\n`;
      } catch (err) {
        log += `[${formatTime()}] 本地保存证书失败: ${err.message}\n`;
      }

      await updateSslState(req.params.domain_id, {
        ssl_status: 'active',
        ssl_expires: expiresAt,
        ssl_log: log
      });

      res.json({ success: true, message: '证书续期成功', expires: expiresAt, local_cert: localCert, log: trimSslLog(log) });
    } else {
      log += `[${formatTime()}] 证书续期失败\n`;

      await updateSslStatusLog(req.params.domain_id, 'error', log);
      res.json({ success: false, message: '证书续期失败', output: result.output, log: trimSslLog(log) });
    }
  } catch (err) {
    log += `[${formatTime()}] 异常错误: ${err.message}\n`;
    try {
      await updateSslStatusLog(req.params.domain_id, 'error', log);
    } catch (saveErr) {
      console.error('[SSL] 保存续期异常日志失败:', saveErr.message);
    }
    console.error('[SSL] 续期证书异常:', err);
    res.status(500).json({ error: err.message, log: trimSslLog(log) });
  }
});

// 安装acme.sh
router.post('/install-acme', async (req, res) => {
  try {
    const { server_id, email } = req.body;

    const server = await getServerById(server_id) || await getDefaultServer(req.user.id);

    if (!server) {
      return res.status(404).json({ error: '没有可用的服务器' });
    }

    const sshService = getSshService(server);

    const installCmd = sslCert.getInstallAcmeCommand(email || 'admin@example.com');
    const result = await sshService.exec(installCmd);

    res.json({
      success: result.success,
      message: result.success ? 'acme.sh安装成功' : '安装失败',
      output: result.output
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取证书路径
router.get('/paths/:domain', async (req, res) => {
  res.json(sslCert.getCertPath(req.params.domain));
});

// 获取当前项目本地保存的证书文件
router.get('/files/:domain_id', async (req, res) => {
  try {
    const domain = await db.get('SELECT * FROM domains WHERE id = ?', [req.params.domain_id]);
    if (!domain) {
      return res.status(404).json({ error: '域名不存在' });
    }

    const localCert = await getLocalCertInfo(domain.domain);
    const files = await getLocalCertFileList(domain.domain);

    res.json({
      domain: domain.domain,
      stored: localCert.stored,
      dir: localCert.dir,
      files,
      metadata: localCert.metadata
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 发布当前项目本地证书到指定服务器目录
router.post('/publish/:domain_id', async (req, res) => {
  const startTime = formatTime();
  let log = `[${startTime}] 开始发布证书\n`;
  try {
    const { server_id, target_dir } = req.body;
    const domain = await db.get('SELECT * FROM domains WHERE id = ?', [req.params.domain_id]);
    if (!domain) {
      return res.status(404).json({ error: '域名不存在' });
    }

    const localCert = await getLocalCertInfo(domain.domain);
    if (!localCert.stored) {
      log += `[${formatTime()}] 错误: 当前项目本地证书不完整，请先申请或续期证书\n`;
      return res.status(400).json({ error: '当前项目本地证书不完整，请先申请或续期证书', log });
    }

    const server = await getServerById(server_id) || await getDefaultServer(domain.user_id);
    if (!server || !server.ip) {
      log += `[${formatTime()}] 错误: 没有可用的发布服务器\n`;
      return res.status(400).json({ error: '没有可用的发布服务器', log });
    }

    const remoteDir = String(target_dir || sslCert.getCertPath(domain.domain).dir).trim();
    if (!remoteDir || !remoteDir.startsWith('/')) {
      return res.status(400).json({ error: '发布目录必须是绝对路径，例如 /www/certs/' + domain.domain });
    }

    const localPaths = getLocalCertPaths(domain.domain);
    const fullchainContent = await readTextIfExists(localPaths.fullchain);
    const keyContent = await readTextIfExists(localPaths.key);
    const certContent = await readTextIfExists(localPaths.cert);
    if (!fullchainContent || !keyContent) {
      log += `[${formatTime()}] 错误: 本地证书文件不完整\n`;
      return res.status(400).json({ error: '本地证书文件不完整', log });
    }

    const remotePaths = {
      dir: remoteDir,
      fullchain: path.posix.join(remoteDir, `${domain.domain}.fullchain.crt`),
      key: path.posix.join(remoteDir, `${domain.domain}.key`),
      cert: path.posix.join(remoteDir, `${domain.domain}.crt`)
    };

    const sshService = getSshService(server);
    log += `[${formatTime()}] 发布服务器: ${getServerLabel(server)}${server.is_default ? '（默认）' : ''}\n`;
    log += `[${formatTime()}] 发布目录: ${remoteDir}\n`;

    const mkdirResult = await sshService.exec(`sudo mkdir -p ${shellQuote(remoteDir)}`);
    if (!mkdirResult.success) {
      throw new Error(mkdirResult.output || '创建远程证书目录失败');
    }

    await writeRemoteFile(sshService, remotePaths.fullchain, fullchainContent, '644');
    log += `[${formatTime()}] 已发布证书链: ${remotePaths.fullchain}\n`;

    await writeRemoteFile(sshService, remotePaths.key, keyContent, '600');
    log += `[${formatTime()}] 已发布私钥: ${remotePaths.key}\n`;

    if (certContent) {
      await writeRemoteFile(sshService, remotePaths.cert, certContent, '644');
      log += `[${formatTime()}] 已发布证书: ${remotePaths.cert}\n`;
    }

    log += `[${formatTime()}] 证书发布完成\n`;
    res.json({
      success: true,
      message: '证书发布成功',
      server: { id: server.id, name: server.name, ip: server.ip, is_default: server.is_default },
      remote_paths: remotePaths,
      log
    });
  } catch (err) {
    log += `[${formatTime()}] 发布失败: ${err.message}\n`;
    res.status(500).json({ error: err.message, log });
  }
});

// 查看证书内容
router.get('/view/:domain_id', async (req, res) => {
  try {
    const domain = await db.get('SELECT * FROM domains WHERE id = ?', [req.params.domain_id]);
    if (!domain) {
      return res.status(404).json({ error: '域名不存在' });
    }

    const localCert = await getLocalCertInfo(domain.domain);
    if (localCert.stored) {
      const localPaths = getLocalCertPaths(domain.domain);
      return res.json({
        cert: (await readTextIfExists(localPaths.fullchain)).trim(),
        key: (await readTextIfExists(localPaths.key)).trim(),
        source: 'local',
        local_cert: localCert
      });
    }

    const server = await getDefaultServer(domain.user_id);

    if (!server) {
      return res.status(400).json({ error: '没有可用的服务器' });
    }

    const sshService = getSshService(server);

    const paths = sslCert.getCertPath(domain.domain);

    // 读取证书和私钥内容
    const certResult = await sshService.exec(`cat ${shellQuote(paths.fullchain)} 2>/dev/null || true`);
    const keyResult = await sshService.exec(`cat ${shellQuote(paths.key)} 2>/dev/null || true`);

    res.json({
      cert: certResult.output?.trim() || '',
      key: keyResult.output?.trim() || '',
      source: 'remote',
      local_cert: localCert
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 下载证书（ZIP压缩包）
router.get('/download/:domain_id', async (req, res) => {
  try {
    const domain = await db.get('SELECT * FROM domains WHERE id = ?', [req.params.domain_id]);
    if (!domain) {
      return res.status(404).json({ error: '域名不存在' });
    }

    const localCert = await getLocalCertInfo(domain.domain);
    let certContent = '';
    let keyContent = '';

    if (localCert.stored) {
      const localPaths = getLocalCertPaths(domain.domain);
      certContent = (await readTextIfExists(localPaths.fullchain)).trim();
      keyContent = (await readTextIfExists(localPaths.key)).trim();
    }

    // 获取服务器
    if (!certContent || !keyContent) {
      const server = await getDefaultServer(domain.user_id);

      if (!server) {
        return res.status(400).json({ error: '没有可用的服务器' });
      }

      const sshService = getSshService(server);

      const paths = sslCert.getCertPath(domain.domain);

      // 读取证书和私钥内容
      const certResult = await sshService.exec(`cat ${shellQuote(paths.fullchain)} 2>/dev/null || true`);
      const keyResult = await sshService.exec(`cat ${shellQuote(paths.key)} 2>/dev/null || true`);

      certContent = certResult.output?.trim() || '';
      keyContent = keyResult.output?.trim() || '';
    }

    if (!certContent || !keyContent) {
      return res.status(404).json({ error: '证书文件不完整' });
    }

    // 创建ZIP文件
    const archiver = require('archiver');
    const archive = archiver('zip', { zlib: { level: 9 } });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${domain.domain}_ssl.zip"`);

    archive.pipe(res);

    if (certContent) {
      archive.append(certContent, { name: `${domain.domain}.fullchain.crt` });
    }
    if (keyContent) {
      archive.append(keyContent, { name: `${domain.domain}.key` });
    }

    await archive.finalize();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 检查所有域名的证书状态（手动刷新）
router.post('/check-all', async (req, res) => {
  try {
    const domains = await db.all('SELECT * FROM domains WHERE ssl_status = ?', ['active']);
    const results = [];

    for (const domain of domains) {
      try {
        // 获取服务器
        let server = await db.get(`
          SELECT sv.* FROM subdomains s
          LEFT JOIN servers sv ON s.server_id = sv.id
          WHERE s.domain_id = ? AND sv.id IS NOT NULL
          LIMIT 1
        `, [domain.id]);

        if (!server) {
          server = await db.get('SELECT * FROM servers LIMIT 1');
        }

        if (!server) {
          results.push({ domain: domain.domain, status: 'skipped', reason: '无可用服务器' });
          continue;
        }

        const sshService = new SshFtpService({
          ip: server.ip,
          port: server.port,
          username: server.username,
          password: server.password
        });

        const checkCmd = sslCert.getCheckCommand(domain.domain);
        const result = await sshService.exec(checkCmd);

        if (result.output?.includes('CERT_EXISTS=true')) {
          const afterMatch = result.output.match(/notAfter=(.+)/);
          if (afterMatch) {
            const expiresAt = parseOpenSSLDate(afterMatch[1].trim());
            await db.run('UPDATE domains SET ssl_expires = ? WHERE id = ?', [expiresAt, domain.id]);
            results.push({ domain: domain.domain, status: 'updated', expires: expiresAt });
          }
        } else {
          results.push({ domain: domain.domain, status: 'no_cert' });
        }
      } catch (err) {
        results.push({ domain: domain.domain, status: 'error', error: err.message });
      }
    }

    res.json({ success: true, checked: domains.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 批量发布证书到多台服务器
router.post('/batch-publish', async (req, res) => {
  try {
    const { domain_ids, server_ids, target_dir_template } = req.body;
    // domain_ids: 要发布的域名ID列表
    // server_ids: 目标服务器ID列表（支持多台）
    // target_dir_template: 目标目录模板，{domain} 会被替换为域名，默认 /www/certs/{domain}
    
    if (!domain_ids || !Array.isArray(domain_ids) || domain_ids.length === 0) {
      return res.status(400).json({ error: '请选择要发布的域名' });
    }
    if (!server_ids || !Array.isArray(server_ids) || server_ids.length === 0) {
      return res.status(400).json({ error: '请选择目标服务器' });
    }
    
    const dirTemplate = target_dir_template || '/www/certs/{domain}';
    
    // 获取域名列表
    const placeholders = domain_ids.map(() => '?').join(',');
    const domains = await db.all(`SELECT * FROM domains WHERE id IN (${placeholders})`, domain_ids);
    if (domains.length === 0) {
      return res.status(400).json({ error: '未找到有效域名' });
    }
    
    // 获取服务器列表
    const serverPlaceholders = server_ids.map(() => '?').join(',');
    const servers = await db.all(`SELECT * FROM servers WHERE id IN (${serverPlaceholders}) AND (status IS NULL OR status != 'disabled')`, server_ids);
    if (servers.length === 0) {
      return res.status(400).json({ error: '未找到有效服务器' });
    }
    
    const results = [];
    let log = `[${formatTime()}] 批量发布证书开始\n`;
    log += `[${formatTime()}] 域名: ${domains.length} 个, 服务器: ${servers.length} 台\n\n`;
    
    for (const domain of domains) {
      log += `========== ${domain.domain} ==========\n`;
      
      // 检查本地证书
      const localCert = await getLocalCertInfo(domain.domain);
      if (!localCert.stored) {
        log += `[${formatTime()}] 跳过: 本地证书不存在\n\n`;
        results.push({ domain: domain.domain, success: false, message: '本地证书不存在', servers: [] });
        continue;
      }
      
      // 读取证书文件
      const localPaths = getLocalCertPaths(domain.domain);
      const fullchainContent = await readTextIfExists(localPaths.fullchain);
      const keyContent = await readTextIfExists(localPaths.key);
      const certContent = await readTextIfExists(localPaths.cert);
      
      if (!fullchainContent || !keyContent) {
        log += `[${formatTime()}] 跳过: 本地证书文件不完整\n\n`;
        results.push({ domain: domain.domain, success: false, message: '本地证书文件不完整', servers: [] });
        continue;
      }
      
      const serverResults = [];
      
      for (const server of servers) {
        const remoteDir = dirTemplate.replace(/\{domain\}/g, domain.domain);
        const remotePaths = {
          dir: remoteDir,
          fullchain: path.posix.join(remoteDir, `${domain.domain}.fullchain.crt`),
          key: path.posix.join(remoteDir, `${domain.domain}.key`),
          cert: path.posix.join(remoteDir, `${domain.domain}.crt`)
        };
        
        try {
          const sshService = getSshService(server);
          log += `[${formatTime()}] → ${getServerLabel(server)}: 发布到 ${remoteDir}\n`;
          
          await sshService.exec(`sudo mkdir -p ${shellQuote(remoteDir)}`);
          await writeRemoteFile(sshService, remotePaths.fullchain, fullchainContent, '644');
          await writeRemoteFile(sshService, remotePaths.key, keyContent, '600');
          if (certContent) {
            await writeRemoteFile(sshService, remotePaths.cert, certContent, '644');
          }
          
          log += `[${formatTime()}]   ✓ 发布成功\n`;
          serverResults.push({ server_id: server.id, server_name: server.name, ip: server.ip, success: true });
        } catch (err) {
          log += `[${formatTime()}]   ✗ 发布失败: ${err.message}\n`;
          serverResults.push({ server_id: server.id, server_name: server.name, ip: server.ip, success: false, message: err.message });
        }
      }
      
      const allSuccess = serverResults.every(r => r.success);
      results.push({ domain: domain.domain, success: allSuccess, servers: serverResults });
      log += '\n';
    }
    
    const totalSuccess = results.filter(r => r.success).length;
    const totalFailed = results.filter(r => !r.success).length;
    log += `[${formatTime()}] 批量发布完成: 成功 ${totalSuccess} 个域名, 失败 ${totalFailed} 个域名\n`;
    
    res.json({
      success: true,
      total: domains.length,
      servers_count: servers.length,
      success_count: totalSuccess,
      failed_count: totalFailed,
      results,
      log
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
