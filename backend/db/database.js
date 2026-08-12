require('dotenv').config();

const db = require('./database-mysql');

db.type = 'mysql';
console.log('✓ 使用 MySQL 数据库');

// SQL 字符串拼接（历史调用点统一走 CONCAT）
db.concat = (...args) => `CONCAT(${args.join(', ')})`;

module.exports = db;
