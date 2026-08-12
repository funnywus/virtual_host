const express = require('express');
const fsSync = require('fs');
const fs = fsSync.promises;
const path = require('path');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const db = require('../db/database');
const { ensureAuditTable, writeAudit } = require('../services/audit-log');

const router = express.Router();
const execAsync = promisify(exec);

router.use(authMiddleware);
router.use(adminMiddleware);

// 备份目录
const BACKUP_DIR = path.join(__dirname, '../backups');

// 确保备份目录存在
async function ensureBackupDir() {
  try {
    await fs.access(BACKUP_DIR);
  } catch {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
  }
}

// 检查 mysqldump 是否可用
async function isMysqldumpAvailable() {
  try {
    await execAsync('which mysqldump');
    return true;
  } catch {
    return false;
  }
}

function getMysqlConfig() {
  return {
    host: process.env.MYSQL_HOST || process.env.DB_HOST || 'localhost',
    port: process.env.MYSQL_PORT || process.env.DB_PORT || 3306,
    user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
    password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || process.env.DB_NAME || 'virtual_host'
  };
}

function assertSafeBackupFilename(filename) {
  if (!/^[\w.-]+\.(sql|db)$/.test(filename)) {
    throw new Error('无效的文件名');
  }
}

function resolveBackupPath(filename) {
  assertSafeBackupFilename(filename);
  return path.join(BACKUP_DIR, filename);
}

function escapeMysqlValue(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Date) return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
  if (Buffer.isBuffer(value)) return `X'${value.toString('hex')}'`;
  return `'${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\0/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\x1a/g, '\\Z')
    .replace(/'/g, "''")}'`;
}

async function backupMysqlWithMysqldump(filepath, config) {
  await new Promise((resolve, reject) => {
    const args = [
      '-h', config.host,
      '-P', String(config.port),
      '-u', config.user,
      '--single-transaction',
      '--routines',
      '--triggers'
    ];

    args.push(config.database);

    const env = config.password ? { ...process.env, MYSQL_PWD: config.password } : process.env;
    const dump = spawn('mysqldump', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const output = fsSync.createWriteStream(filepath);
    const stderrChunks = [];
    let dumpExitCode = null;
    let streamFinished = false;
    let settled = false;

    const settle = (err) => {
      if (settled) return;

      if (err) {
        settled = true;
        reject(err);
        return;
      }

      if (dumpExitCode === 0 && streamFinished) {
        settled = true;
        resolve();
      }
    };

    dump.stderr.on('data', chunk => {
      stderrChunks.push(chunk);
    });

    dump.stdout.pipe(output);

    dump.on('error', settle);
    output.on('error', settle);
    output.on('finish', () => {
      streamFinished = true;
      settle();
    });

    dump.on('close', code => {
      dumpExitCode = code;
      output.end();

      if (code !== 0) {
        const message = Buffer.concat(stderrChunks).toString('utf8').trim();
        settle(new Error(message || `mysqldump 退出码 ${code}`));
      }
    });
  });
}

// 使用 Node.js 导出 MySQL 数据（当 mysqldump 不可用时）
async function backupMysqlWithNode(filepath) {
  const mysql = require('mysql2/promise');
  const config = getMysqlConfig();
  
  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database
  });
  
  let sqlDump = `-- MySQL Backup\n-- Generated: ${new Date().toISOString()}\n\n`;
  sqlDump += `SET FOREIGN_KEY_CHECKS=0;\n\n`;
  
  // 获取所有表
  const [tables] = await connection.query('SHOW TABLES');
  
  for (const tableRow of tables) {
    const tableName = Object.values(tableRow)[0];
    
    // 获取建表语句
    const [createTable] = await connection.query(`SHOW CREATE TABLE \`${tableName}\``);
    sqlDump += `-- Table: ${tableName}\n`;
    sqlDump += `DROP TABLE IF EXISTS \`${tableName}\`;\n`;
    sqlDump += createTable[0]['Create Table'] + ';\n\n';
    
    // 获取表数据
    const [rows] = await connection.query(`SELECT * FROM \`${tableName}\``);
    
    if (rows.length > 0) {
      sqlDump += `-- Data for table: ${tableName}\n`;
      
      for (const row of rows) {
        const columns = Object.keys(row);
        const values = columns.map(col => escapeMysqlValue(row[col]));
        
        sqlDump += `INSERT INTO \`${tableName}\` (\`${columns.join('`, `')}\`) VALUES (${values.join(', ')});\n`;
      }
      
      sqlDump += '\n';
    }
  }
  
  sqlDump += `SET FOREIGN_KEY_CHECKS=1;\n`;
  
  await connection.end();
  await fs.writeFile(filepath, sqlDump, 'utf8');
}

// 立即备份数据库
router.post('/backup', async (req, res) => {
  let filepath = '';

  try {
    await ensureBackupDir();
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `backup_${timestamp}.sql`;
    filepath = path.join(BACKUP_DIR, filename);

    const hasMysqldump = await isMysqldumpAvailable();
    if (hasMysqldump) {
      await backupMysqlWithMysqldump(filepath, getMysqlConfig());
    } else {
      await backupMysqlWithNode(filepath);
    }
    
    // 获取文件大小
    const stats = await fs.stat(filepath);
    
    res.json({
      success: true,
      filename,
      size: stats.size,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('备份失败:', err);
    if (filepath) {
      await fs.unlink(filepath).catch(() => {});
    }
    res.status(500).json({ error: '备份失败: ' + err.message });
  }
});

// 获取备份列表
router.get('/backups', async (req, res) => {
  try {
    await ensureBackupDir();
    
    const files = await fs.readdir(BACKUP_DIR);
    const backups = [];
    
    for (const file of files) {
      if (file.endsWith('.sql') || file.endsWith('.db')) {
        const filepath = path.join(BACKUP_DIR, file);
        const stats = await fs.stat(filepath);
        
        backups.push({
          filename: file,
          size: stats.size,
          created_at: stats.mtime.toISOString().replace('T', ' ').slice(0, 19)
        });
      }
    }
    
    // 按时间倒序排列
    backups.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    res.json({ backups });
  } catch (err) {
    console.error('获取备份列表失败:', err);
    res.status(500).json({ error: '获取备份列表失败' });
  }
});

// 下载备份文件
router.get('/backup/download/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filepath = resolveBackupPath(filename);
    
    // 检查文件是否存在
    await fs.access(filepath);
    
    res.download(filepath, filename);
  } catch (err) {
    console.error('下载备份失败:', err);
    const status = err.message === '无效的文件名' ? 400 : 404;
    res.status(status).json({ error: status === 400 ? err.message : '文件不存在' });
  }
});

// 删除备份文件
router.delete('/backup/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    const filepath = resolveBackupPath(filename);
    await fs.unlink(filepath);
    await writeAudit({
      req,
      action: 'backup.delete',
      resource: 'backup',
      detail: { filename }
    });

    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    console.error('删除备份失败:', err);
    const status = err.message === '无效的文件名' ? 400 : 500;
    res.status(status).json({ error: status === 400 ? err.message : '删除失败' });
  }
});

// 审计日志列表
router.get('/audit-logs', async (req, res) => {
  try {
    await ensureAuditTable();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
    const offset = (page - 1) * pageSize;
    const action = String(req.query.action || '').trim();

    let where = '';
    const params = [];
    if (action) {
      where = 'WHERE action = ?';
      params.push(action);
    }

    const countRow = await db.get(`SELECT COUNT(*) as total FROM audit_logs ${where}`, params);
    const list = await db.all(
      `SELECT id, user_id, username, action, resource, resource_id, ip, detail, created_at
       FROM audit_logs ${where}
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, pageSize, offset]
    );

    res.json({
      list,
      total: countRow?.total || 0,
      page,
      pageSize
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 获取系统信息
router.get('/info', async (req, res) => {
  try {
    const diagnostics = require('../services/system-diagnostics');
    const uptime = process.uptime();
    const mem = process.memoryUsage();
    const pkg = require('../package.json');
    
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const uptimeStr = `${days}天 ${hours}小时 ${minutes}分钟`;
    const temp = await diagnostics.getDirSize(diagnostics.TEMP_CHUNKS_DIR);
    
    res.json({
      version: pkg.version || '2.0.0',
      nodeVersion: process.version,
      platform: `${process.platform} ${process.arch}`,
      dbType: 'MySQL',
      uptime: uptimeStr,
      uptimeSeconds: Math.floor(uptime),
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal
      },
      temp: {
        sessions: temp.sessions,
        files: temp.files,
        bytes: temp.bytes
      },
      port: process.env.PORT || 3000,
      pid: process.pid
    });
  } catch (err) {
    console.error('获取系统信息失败:', err);
    res.status(500).json({ error: '获取系统信息失败' });
  }
});

// ========== 运维检测 ==========

router.get('/stats', async (req, res) => {
  try {
    const diagnostics = require('../services/system-diagnostics');
    res.json(await diagnostics.getStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/diagnose/expire', async (req, res) => {
  try {
    const diagnostics = require('../services/system-diagnostics');
    const result = await diagnostics.runExpireCheck();
    res.json({
      success: true,
      message: result.total === 0
        ? '没有需要停用的过期子域名'
        : `已处理 ${result.disabled} 个过期子域名（Nginx 禁用，DNS 未改动）`,
      ...result
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/diagnose/servers', async (req, res) => {
  try {
    const diagnostics = require('../services/system-diagnostics');
    res.json({ success: true, ...(await diagnostics.checkServers()) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/diagnose/dns', async (req, res) => {
  try {
    const diagnostics = require('../services/system-diagnostics');
    res.json({ success: true, ...(await diagnostics.checkDnsPlatforms()) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/diagnose/sites', async (req, res) => {
  try {
    const diagnostics = require('../services/system-diagnostics');
    const limit = Math.min(parseInt(req.body?.limit || 200, 10) || 200, 500);
    res.json({ success: true, ...(await diagnostics.checkSiteHealth({ limit })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function getNextSslCheckAt(hour = 3, from = new Date()) {
  const next = new Date(from);
  next.setHours(Number(hour) || 3, 0, 0, 0);
  if (next <= from) next.setDate(next.getDate() + 1);
  const pad = n => String(n).padStart(2, '0');
  return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())} ${pad(next.getHours())}:${pad(next.getMinutes())}:${pad(next.getSeconds())}`;
}

function buildSslRenewalSummary(domains, settings = {}) {
  const now = Date.now();
  const beforeDays = settings.ssl_renew_before_days || 30;
  const checkHour = settings.ssl_check_hour ?? 3;
  const hourLabel = `${String(checkHour).padStart(2, '0')}:00`;
  const summary = {
    total: domains.length,
    active: 0,
    none: 0,
    failed: 0,
    expiring_soon: 0,
    expired: 0,
    renew_window: 0,
    auto_renew: !!settings.ssl_auto_renew,
    renew_before_days: beforeDays,
    schedule: {
      check_time: `每天 ${hourLabel}`,
      check_hour: checkHour,
      next_check_at: getNextSslCheckAt(checkHour),
      auto_renew: !!settings.ssl_auto_renew,
      renew_before_days: beforeDays,
      last_ssl_check_at: settings.last_ssl_check_at || null,
      last_ssl_renew_at: settings.last_ssl_renew_at || null,
      last_ssl_renew_summary: settings.last_ssl_renew_summary || null,
      note: settings.ssl_auto_renew
        ? `已开启自动续期：到期前 ${beforeDays} 天自动续期`
        : '自动续期已关闭，仅做到期时间巡检'
    },
    rows: []
  };

  for (const d of domains) {
    const status = d.ssl_status || 'none';
    if (status === 'active') summary.active += 1;
    else if (status === 'failed' || status === 'error') summary.failed += 1;
    else summary.none += 1;

    let note = status === 'active' ? '正常' : (status === 'none' ? '未申请' : status);
    let remaining_days = null;
    let urgency = 'none'; // none | ok | soon | critical | expired

    if (d.ssl_expires) {
      const exp = new Date(d.ssl_expires).getTime();
      if (!Number.isNaN(exp)) {
        remaining_days = Math.ceil((exp - now) / 86400000);
        if (remaining_days < 0) {
          summary.expired += 1;
          note = '证书已过期，需立即续期';
          urgency = 'expired';
        } else if (remaining_days <= 7) {
          summary.expiring_soon += 1;
          summary.renew_window += 1;
          note = `${remaining_days} 天内到期，请尽快续期`;
          urgency = 'critical';
        } else if (remaining_days <= 15) {
          summary.expiring_soon += 1;
          summary.renew_window += 1;
          note = `${remaining_days} 天内到期`;
          urgency = 'soon';
        } else if (remaining_days <= beforeDays) {
          summary.renew_window += 1;
          note = `${remaining_days} 天后到期，将自动续期`;
          urgency = 'soon';
        } else {
          note = `剩余 ${remaining_days} 天`;
          urgency = 'ok';
        }
      }
    }

    summary.rows.push({
      id: d.id,
      domain: d.domain,
      ssl_status: status,
      ssl_type: d.ssl_type || '-',
      ssl_expires: d.ssl_expires || '',
      remaining_days,
      urgency,
      note
    });
  }

  // 到期近的排前面
  summary.rows.sort((a, b) => {
    const av = a.remaining_days === null ? 99999 : a.remaining_days;
    const bv = b.remaining_days === null ? 99999 : b.remaining_days;
    return av - bv;
  });

  return summary;
}

router.get('/ssl-renewals', async (req, res) => {
  try {
    const db = require('../db/database');
    const { getSettings } = require('../services/system-settings');
    const settings = await getSettings();
    const domains = await db.all(`
      SELECT id, domain, ssl_status, ssl_type, ssl_expires
      FROM domains
      ORDER BY id DESC
    `);
    res.json({ success: true, ...buildSslRenewalSummary(domains, settings), settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/diagnose/ssl', async (req, res) => {
  try {
    const db = require('../db/database');
    const { getSettings } = require('../services/system-settings');
    const settings = await getSettings();
    const domains = await db.all(`
      SELECT id, domain, ssl_status, ssl_type, ssl_expires
      FROM domains
      ORDER BY id DESC
    `);
    res.json({ success: true, ...buildSslRenewalSummary(domains, settings), settings });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/settings', async (req, res) => {
  try {
    const { getSettings } = require('../services/system-settings');
    res.json({ success: true, settings: await getSettings() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const { saveSettings } = require('../services/system-settings');
    const body = req.body || {};
    const settings = await saveSettings(body);

    let schedule = null;
    if (Object.prototype.hasOwnProperty.call(body, 'ssl_check_hour')) {
      const { rescheduleSslCheck } = require('../services/ssl-schedule');
      schedule = await rescheduleSslCheck();
    }

    res.json({
      success: true,
      settings,
      schedule,
      message: schedule?.message || '设置已保存'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ssl-auto-renew/run', async (req, res) => {
  try {
    const { checkAndAutoRenew } = require('../services/ssl-auto-renew');
    const result = await checkAndAutoRenew({ force: !!req.body?.force });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/diagnose/full', async (req, res) => {
  try {
    const diagnostics = require('../services/system-diagnostics');
    const result = await diagnostics.runFullDiagnose();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cleanup-temp', async (req, res) => {
  try {
    const diagnostics = require('../services/system-diagnostics');
    res.json({ success: true, ...(await diagnostics.cleanupTemp()) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
