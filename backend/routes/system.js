const express = require('express');
const fsSync = require('fs');
const fs = fsSync.promises;
const path = require('path');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

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

function resolveSqliteDbPath(dbPath) {
  if (path.isAbsolute(dbPath)) return dbPath;
  return path.resolve(__dirname, '..', dbPath);
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
    const dbType = process.env.DB_TYPE || 'sqlite';
    const filename = dbType === 'sqlite' ? `backup_${timestamp}.db` : `backup_${timestamp}.sql`;
    filepath = path.join(BACKUP_DIR, filename);
    
    if (dbType === 'mysql') {
      // 检查 mysqldump 是否可用
      const hasMysqldump = await isMysqldumpAvailable();
      
      if (hasMysqldump) {
        // 使用 mysqldump 命令
        await backupMysqlWithMysqldump(filepath, getMysqlConfig());
      } else {
        // 使用 Node.js 方式备份
        await backupMysqlWithNode(filepath);
      }
    } else {
      // SQLite 备份
      const dbPath = resolveSqliteDbPath(process.env.DB_PATH || 'data/app.db');
      await fs.copyFile(dbPath, filepath);
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
    
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    console.error('删除备份失败:', err);
    const status = err.message === '无效的文件名' ? 400 : 500;
    res.status(status).json({ error: status === 400 ? err.message : '删除失败' });
  }
});

// 获取系统信息
router.get('/info', async (req, res) => {
  try {
    const dbType = process.env.DB_TYPE || 'sqlite';
    const uptime = process.uptime();
    
    // 格式化运行时间
    const days = Math.floor(uptime / 86400);
    const hours = Math.floor((uptime % 86400) / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const uptimeStr = `${days}天 ${hours}小时 ${minutes}分钟`;
    
    res.json({
      nodeVersion: process.version,
      dbType: dbType === 'mysql' ? 'MySQL' : 'SQLite',
      uptime: uptimeStr
    });
  } catch (err) {
    console.error('获取系统信息失败:', err);
    res.status(500).json({ error: '获取系统信息失败' });
  }
});

module.exports = router;
