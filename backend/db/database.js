require('dotenv').config();

const dbType = process.env.DB_TYPE || 'sqlite';

let db;

if (dbType === 'mysql') {
  console.log('✓ 使用 MySQL 数据库');
  db = require('./database-mysql');
} else {
  console.log('✓ 使用 SQLite 数据库');
  db = require('./database-sqlite');
}

// 数据库类型
db.type = dbType;

// SQL 兼容函数 - 字符串拼接
db.concat = (...args) => {
  if (dbType === 'mysql') {
    return `CONCAT(${args.join(', ')})`;
  }
  // SQLite 使用 ||
  return args.join(' || ');
};

module.exports = db;
