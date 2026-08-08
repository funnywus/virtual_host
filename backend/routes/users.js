const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { writeAudit } = require('../services/audit-log');

const router = express.Router();

router.use(authMiddleware);

// 获取当前用户信息
router.get('/me', async (req, res) => {
  try {
    const user = await db.get('SELECT id, username, email, role, created_at FROM users WHERE id = ?', [req.user.id]);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 管理员：获取所有用户
router.get('/', adminMiddleware, async (req, res) => {
  try {
    const users = await db.all('SELECT id, username, email, role, created_at FROM users');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 管理员：创建用户
router.post('/', adminMiddleware, async (req, res) => {
  try {
    const { username, email, password, role = 'user' } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: '用户名、邮箱和密码不能为空' });
    }

    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: '无效的用户角色' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await db.run(
      'INSERT INTO users (username, email, password, role) VALUES (?, ?, ?, ?)',
      [username, email, hashedPassword, role]
    );

    await writeAudit({
      req,
      action: 'user.create',
      resource: 'user',
      resourceId: result.lastID,
      detail: { username, email, role }
    });
    res.json({
      id: result.lastID,
      username,
      email,
      role,
      message: 'User created'
    });
  } catch (err) {
    const isDuplicate = /duplicate|unique/i.test(err.message);
    res.status(isDuplicate ? 400 : 500).json({
      error: isDuplicate ? '用户名或邮箱已存在' : err.message
    });
  }
});

// 管理员：修改用户角色
router.put('/:id/role', adminMiddleware, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: '无效的用户角色' });
    }
    await db.run('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
    await writeAudit({
      req,
      action: 'user.role_update',
      resource: 'user',
      resourceId: req.params.id,
      detail: { role }
    });
    res.json({ message: 'Role updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 管理员：删除用户
router.delete('/:id', adminMiddleware, async (req, res) => {
  try {
    if (String(req.params.id) === String(req.user.id)) {
      return res.status(400).json({ error: '不能删除当前登录账号' });
    }
    await db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
    await writeAudit({
      req,
      action: 'user.delete',
      resource: 'user',
      resourceId: req.params.id
    });
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 修改密码
router.put('/password', async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const user = await db.get('SELECT password FROM users WHERE id = ?', [req.user.id]);
    
    const valid = await bcrypt.compare(oldPassword, user.password);
    if (!valid) {
      return res.status(400).json({ error: 'Invalid old password' });
    }
    
    const hashed = await bcrypt.hash(newPassword, 10);
    await db.run('UPDATE users SET password = ? WHERE id = ?', [hashed, req.user.id]);
    res.json({ message: 'Password updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
