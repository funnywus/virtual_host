#!/usr/bin/env node

/**
 * SQLite 转 MySQL 工具
 * 用法: node sqlite-to-mysql.js [sqlite文件路径] [输出mysql文件路径]
 * 示例: node sqlite-to-mysql.js ../data/app.db output.sql
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// 获取命令行参数
const sqliteFile = process.argv[2] || '../data/app.db';
const outputFile = process.argv[3] || 'output.sql';

// 检查 SQLite 文件是否存在
if (!fs.existsSync(sqliteFile)) {
  console.error(`错误: SQLite 文件不存在: ${sqliteFile}`);
  process.exit(1);
}

console.log(`开始转换: ${sqliteFile} -> ${outputFile}`);

const db = new sqlite3.Database(sqliteFile, sqlite3.OPEN_READONLY);

// MySQL 输出流
let mysqlOutput = [];

// 添加 MySQL 头部
mysqlOutput.push('-- MySQL dump generated from SQLite');
mysqlOutput.push('-- Generated at: ' + new Date().toISOString());
mysqlOutput.push('');
mysqlOutput.push('SET NAMES utf8mb4;');
mysqlOutput.push('SET FOREIGN_KEY_CHECKS = 0;');
mysqlOutput.push('');

// SQLite 类型转 MySQL 类型
function sqliteTypeToMysql(type, columnName, defaultValue) {
  type = (type || '').toUpperCase();
  
  if (type.includes('INT')) return 'INT';
  
  // 日志、配置、内容等长文本字段使用 LONGTEXT（支持 4GB）
  const longTextFields = ['log', 'config', 'content', 'message', 'description', 'nginx_config', 'ssl_log', 'output', 'error'];
  const isLongTextField = longTextFields.some(field => columnName.toLowerCase().includes(field));
  
  if ((type.includes('TEXT') || type.includes('CHAR'))) {
    // 长文本字段用 LONGTEXT，即使有默认值也忽略
    if (isLongTextField) {
      return 'LONGTEXT';
    }
    // 有默认值的短文本用 VARCHAR
    if (defaultValue !== null) {
      return 'VARCHAR(255)';
    }
    // 其他短文本字段用 VARCHAR
    return 'VARCHAR(500)';
  }
  
  if (type.includes('BLOB')) return 'LONGBLOB';
  if (type.includes('REAL') || type.includes('DOUBLE')) return 'DOUBLE';
  if (type.includes('NUMERIC') || type.includes('DECIMAL')) return 'DECIMAL(10,2)';
  if (type.includes('DATETIME')) return 'DATETIME';
  if (type.includes('DATE')) return 'DATE';
  if (type.includes('TIME')) return 'TIMESTAMP';
  
  return 'VARCHAR(500)'; // 默认
}

// 转义 MySQL 值
function escapeMysqlValue(value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  
  if (typeof value === 'number') {
    return value;
  }
  
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  
  // 字符串转义
  value = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  
  return `'${value}'`;
}

// 获取所有表名
db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", async (err, tables) => {
  if (err) {
    console.error('获取表列表失败:', err);
    db.close();
    process.exit(1);
  }
  
  console.log(`找到 ${tables.length} 个表`);
  
  let processedTables = 0;
  
  for (const table of tables) {
    const tableName = table.name;
    console.log(`处理表: ${tableName}`);
    
    // 获取表结构
    await new Promise((resolve) => {
      db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
        if (err) {
          console.error(`获取表 ${tableName} 结构失败:`, err);
          resolve();
          return;
        }
        
        // 生成 CREATE TABLE 语句
        mysqlOutput.push(`-- Table: ${tableName}`);
        mysqlOutput.push(`DROP TABLE IF EXISTS \`${tableName}\`;`);
        mysqlOutput.push(`CREATE TABLE \`${tableName}\` (`);
        
        const columnDefs = columns.map((col, index) => {
          const mysqlType = sqliteTypeToMysql(col.type, col.name, col.dflt_value);
          let def = `  \`${col.name}\` ${mysqlType}`;
          
          if (col.notnull) {
            def += ' NOT NULL';
          }
          
          // TEXT/LONGTEXT/BLOB 类型不能有默认值
          if (col.dflt_value !== null && !['TEXT', 'LONGTEXT', 'BLOB', 'LONGBLOB'].includes(mysqlType)) {
            if (col.dflt_value === 'CURRENT_TIMESTAMP') {
              def += ' DEFAULT CURRENT_TIMESTAMP';
            } else {
              // 移除多余的引号
              let defaultVal = col.dflt_value.replace(/^'(.*)'$/, '$1');
              def += ` DEFAULT ${escapeMysqlValue(defaultVal)}`;
            }
          }
          
          if (col.pk) {
            def += ' PRIMARY KEY';
            if (mysqlType === 'INT') {
              def += ' AUTO_INCREMENT';
            }
          }
          
          return def;
        });
        
        mysqlOutput.push(columnDefs.join(',\n'));
        mysqlOutput.push(`) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`);
        mysqlOutput.push('');
        
        // 获取表数据
        db.all(`SELECT * FROM ${tableName}`, (err, rows) => {
          if (err) {
            console.error(`获取表 ${tableName} 数据失败:`, err);
            resolve();
            return;
          }
          
          if (rows.length > 0) {
            console.log(`  - ${rows.length} 行数据`);
            
            // 分批插入（每 100 行一批）
            const batchSize = 100;
            for (let i = 0; i < rows.length; i += batchSize) {
              const batch = rows.slice(i, i + batchSize);
              
              mysqlOutput.push(`-- Data for table ${tableName} (rows ${i + 1} to ${Math.min(i + batchSize, rows.length)})`);
              mysqlOutput.push(`INSERT INTO \`${tableName}\` (\`${columns.map(c => c.name).join('`, `')}\`) VALUES`);
              
              const values = batch.map((row, index) => {
                const rowValues = columns.map(col => escapeMysqlValue(row[col.name]));
                const isLast = index === batch.length - 1;
                return `  (${rowValues.join(', ')})${isLast ? ';' : ','}`;
              });
              
              mysqlOutput.push(values.join('\n'));
              mysqlOutput.push('');
            }
          } else {
            console.log(`  - 0 行数据`);
          }
          
          resolve();
        });
      });
    });
    
    processedTables++;
  }
  
  // 添加 MySQL 尾部
  mysqlOutput.push('SET FOREIGN_KEY_CHECKS = 1;');
  mysqlOutput.push('');
  
  // 写入文件
  fs.writeFileSync(outputFile, mysqlOutput.join('\n'), 'utf8');
  
  console.log('');
  console.log(`✅ 转换完成！`);
  console.log(`输出文件: ${path.resolve(outputFile)}`);
  console.log(`处理了 ${processedTables} 个表`);
  
  db.close();
});
