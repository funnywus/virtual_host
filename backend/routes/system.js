const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const db = require('../db/database');

const router = express.Router();
const execAsync = promisify(exec);

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

// 使用 Node.js 导出 MySQL 数据（当 mysqldump 不可用时）
async function backupMysqlWithNode(filepath) {
  const mysql = require('mysql2/promise');
  
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'vhost'
  });
  
  let sqlDump = `-- MySQL Backup\n-- Generated: ${new Date().toISOString()}\n\n`;
  sqlDump += `SET FOREIGN_KEY_CHECKS=0;\n\n`;
  
  // 获取所有表
  const [tables] = await connection.query('SHOW TABLES');
  const dbName = process.env.DB_NAME || 'vhost';
  const tableKey = `Tables_in_${dbName}`;
  
  for (const tableRow of tables) {
    const tableName = tableRow[tableKey];
    
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
        const values = columns.map(col => {
          const val = row[col];
          if (val === null) return 'NULL';
          if (typeof val === 'number') return val;
          if (val instanceof Date) return `'${val.toISOString().slice(0, 19).replace('T', ' ')}'`;
          return `'${String(val).replace(/'/g, "''")}'`;
        });
        
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
  try {
    await ensureBackupDir();
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const dbType = process.env.DB_TYPE || 'sqlite';
    const filename = dbType === 'sqlite' ? `backup_${timestamp}.db` : `backup_${timestamp}.sql`;
    const filepath = path.join(BACKUP_DIR, filename);
    
    if (dbType === 'mysql') {
      // 检查 mysqldump 是否可用
      const hasMysqldump = await isMysqldumpAvailable();
      
      if (hasMysqldump) {
        // 使用 mysqldump 命令
        const dbHost = process.env.DB_HOST || 'localhost';
        const dbPort = process.env.DB_PORT || 3306;
        const dbUser = process.env.DB_USER || 'root';
        const dbPass = process.env.DB_PASSWORD || '';
        const dbName = process.env.DB_NAME || 'vhost';
        
        const cmd = `mysqldump -h ${dbHost} -P ${dbPort} -u ${dbUser} ${dbPass ? `-p${dbPass}` : ''} ${dbName} > "${filepath}"`;
        await execAsync(cmd);
      } else {
        // 使用 Node.js 方式备份
        await backupMysqlWithNode(filepath);
      }
    } else {
      // SQLite 备份
      const dbPath = process.env.DB_PATH || path.join(__dirname, '../data/app.db');
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
    
    // 安全检查：防止路径遍历攻击
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: '无效的文件名' });
    }
    
    const filepath = path.join(BACKUP_DIR, filename);
    
    // 检查文件是否存在
    await fs.access(filepath);
    
    res.download(filepath, filename);
  } catch (err) {
    console.error('下载备份失败:', err);
    res.status(404).json({ error: '文件不存在' });
  }
});

// 删除备份文件
router.delete('/backup/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    
    // 安全检查
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({ error: '无效的文件名' });
    }
    
    const filepath = path.join(BACKUP_DIR, filename);
    await fs.unlink(filepath);
    
    res.json({ success: true, message: '删除成功' });
  } catch (err) {
    console.error('删除备份失败:', err);
    res.status(500).json({ error: '删除失败' });
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
