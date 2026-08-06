const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

let pool = null;

// 创建 MySQL 连接池
function createPool() {
  if (pool) return pool;
  
  pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'virtual_host',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0
  });
  
  return pool;
}

// 初始化数据库（执行 schema）
async function init() {
  try {
    const pool = createPool();
    const connection = await pool.getConnection();
    
    console.log('MySQL 数据库连接成功');
    
    // 检查表是否存在
    const [tables] = await connection.query("SHOW TABLES LIKE 'users'");
    
    if (tables.length === 0) {
      console.log('数据库表不存在，请先导入 SQL 文件');
      console.log('使用命令: mysql -u root -p virtual_host < scripts/output.sql');
    } else {
      await runMigrations(connection);
    }
    
    connection.release();
  } catch (err) {
    console.error('MySQL 数据库初始化失败:', err.message);
    throw err;
  }
}

async function runMigrations(connection) {
  const migrations = [
    {
      table: 'server_tags',
      column: 'is_filterable',
      sql: 'ALTER TABLE server_tags ADD COLUMN is_filterable TINYINT DEFAULT 1'
    }
  ];

  for (const migration of migrations) {
    const [columns] = await connection.query(
      `SHOW COLUMNS FROM ${migration.table} LIKE ?`,
      [migration.column]
    );
    if (columns.length === 0) {
      await connection.query(migration.sql);
      console.log(`✓ 已添加 ${migration.table}.${migration.column} 列`);
    }
  }

  // max_upload_size 存字节数，INT 最大约 2GB-1，≥2GB 会报 Out of range
  const [uploadSizeCols] = await connection.query(
    "SHOW COLUMNS FROM ftp_accounts LIKE 'max_upload_size'"
  );
  if (uploadSizeCols.length > 0) {
    const type = String(uploadSizeCols[0].Type || '').toLowerCase();
    if (!type.includes('bigint')) {
      await connection.query(
        'ALTER TABLE ftp_accounts MODIFY COLUMN max_upload_size BIGINT DEFAULT 524288000'
      );
      console.log('✓ 已将 ftp_accounts.max_upload_size 升级为 BIGINT');
    }
  }
}

// 执行查询（返回所有行）
async function all(sql, params = []) {
  const pool = createPool();
  const [rows] = await pool.execute(sql, params);
  return rows;
}

// 执行查询（返回单行）
async function get(sql, params = []) {
  const pool = createPool();
  const [rows] = await pool.execute(sql, params);
  return rows[0] || null;
}

// 执行插入/更新/删除
async function run(sql, params = []) {
  const pool = createPool();
  const [result] = await pool.execute(sql, params);
  return {
    lastID: result.insertId,
    changes: result.affectedRows
  };
}

// 关闭连接池
async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  init,
  all,
  get,
  run,
  close
};
