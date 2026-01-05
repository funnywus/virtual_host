// 初始化管理员账号脚本
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = './data/app.db';
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

const username = process.argv[2] || 'admin';
const password = process.argv[3] || 'admin123';
const email = process.argv[4] || 'admin@example.com';

async function createAdmin() {
  const hashedPassword = await bcrypt.hash(password, 10);
  
  db.run(`
    INSERT OR REPLACE INTO users (username, email, password, role) 
    VALUES (?, ?, ?, 'admin')
  `, [username, email, hashedPassword], function(err) {
    if (err) {
      console.error('Error creating admin:', err.message);
    } else {
      console.log(`Admin user created: ${username}`);
      console.log(`Password: ${password}`);
    }
    db.close();
  });
}

createAdmin();
