const express = require('express');
const db = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// 获取所有标签
router.get('/', async (req, res) => {
  try {
    const tags = await db.all('SELECT * FROM server_tags ORDER BY name');
    res.json(tags);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 添加标签
router.post('/', async (req, res) => {
  try {
    const { name, color, is_filterable = 1 } = req.body;
    if (!name) return res.status(400).json({ error: '标签名称不能为空' });
    
    const result = await db.run(
      'INSERT INTO server_tags (name, color, is_filterable, user_id) VALUES (?, ?, ?, ?)',
      [name.trim(), color || '', is_filterable ? 1 : 0, req.user.id]
    );
    res.json({ id: result.lastID, name, color, is_filterable: is_filterable ? 1 : 0 });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      res.status(400).json({ error: '标签已存在' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// 更新标签
router.put('/:id', async (req, res) => {
  try {
    const { name, color, is_filterable = 1 } = req.body;
    await db.run(
      'UPDATE server_tags SET name = ?, color = ?, is_filterable = ? WHERE id = ?',
      [name, color || '', is_filterable ? 1 : 0, req.params.id]
    );
    res.json({ message: '更新成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除标签
router.delete('/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM server_tags WHERE id = ?', [req.params.id]);
    res.json({ message: '删除成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 设置默认标签
router.post('/:id/set-default', async (req, res) => {
  try {
    await db.run('UPDATE server_tags SET is_default = 0 WHERE user_id = ?', [req.user.id]);
    await db.run('UPDATE server_tags SET is_default = 1 WHERE id = ?', [req.params.id]);
    res.json({ message: '已设为默认' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
