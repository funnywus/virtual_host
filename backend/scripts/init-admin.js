// 初始化管理员账号脚本，跟随 backend/.env 中的 DB_TYPE 使用当前运行数据库。
const path = require('path');
const bcrypt = require('bcryptjs');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../db/database');

const username = process.argv[2] || 'admin';
const password = process.argv[3] || 'admin123';
const email = process.argv[4] || 'admin@example.com';

async function createAdmin() {
  try {
    await db.init();

    const hashedPassword = await bcrypt.hash(password, 10);
    const existing = await db.get('SELECT id FROM users WHERE username = ?', [username]);

    if (existing) {
      await db.run(
        'UPDATE users SET email = ?, password = ?, role = ? WHERE id = ?',
        [email, hashedPassword, 'admin', existing.id]
      );
      console.log(`Admin user updated: ${username}`);
    } else {
      await db.run(
        'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
        [username, email, hashedPassword, 'admin']
      );
      console.log(`Admin user created: ${username}`);
    }

    console.log(`Password: ${password}`);
  } catch (err) {
    console.error('Error creating admin:', err.message);
    process.exitCode = 1;
  } finally {
    await db.close?.();
  }
}

createAdmin();
