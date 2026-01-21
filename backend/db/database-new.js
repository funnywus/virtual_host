require('dotenv').config();

const dbType = process.env.DB_TYPE || 'sqlite';

let db;

if (dbType === 'mysql') {
  console.log('使用 MySQL 数据库');
  db = require('./database-mysql');
} else {
  console.log('使用 SQLite 数据库');
  db = require('./database-sqlite');
}

module.exports = db;
