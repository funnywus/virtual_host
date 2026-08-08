const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const { getJwtSecret } = require('../utils/env-check');
const { loginLimiter } = require('../middleware/rate-limit');
const { writeAudit } = require('../services/audit-log');

const router = express.Router();

function isRegisterAllowed() {
  const flag = String(process.env.ALLOW_REGISTER || '').trim().toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes' || flag === 'on';
}

// 注册（默认关闭；需 ALLOW_REGISTER=true，生产环境请用管理员创建用户）
router.post('/register', loginLimiter, async (req, res) => {
  try {
    if (!isRegisterAllowed()) {
      return res.status(403).json({
        error: '开放注册已关闭，请联系管理员创建账号',
        code: 'register_disabled'
      });
    }

    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.run(
      'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
      [username, email, hashedPassword, 'user']
    );

    await writeAudit({
      req,
      username,
      action: 'user.register',
      resource: 'user',
      detail: { email }
    });

    res.json({ message: 'User registered successfully' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 登录
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);

    if (!user) {
      await writeAudit({
        req,
        username: username || null,
        action: 'login.failed',
        resource: 'auth',
        detail: { reason: 'user_not_found' }
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      await writeAudit({
        req,
        userId: user.id,
        username: user.username,
        action: 'login.failed',
        resource: 'auth',
        detail: { reason: 'bad_password' }
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      getJwtSecret(),
      { expiresIn: '24h' }
    );

    await writeAudit({
      req,
      userId: user.id,
      username: user.username,
      action: 'login.success',
      resource: 'auth',
      detail: { role: user.role }
    });

    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
