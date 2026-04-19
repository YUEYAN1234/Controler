const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET, authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Register
const INVITE_CODE = process.env.INVITE_CODE || 'change-me';

router.post('/register', (req, res) => {
  const { username, password, displayName, inviteCode } = req.body;

  if (!username || !password || !displayName || !inviteCode) {
    return res.status(400).json({ error: '请填写所有字段' });
  }

  if (inviteCode !== INVITE_CODE) {
    return res.status(400).json({ error: '邀请码错误' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: '用户名至少3个字符' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少6个字符' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return res.status(400).json({ error: '用户名已存在' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)').run(username, hash, displayName);

  const token = jwt.sign(
    { id: result.lastInsertRowid, username, displayName, role: 'member' },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ token, user: { id: result.lastInsertRowid, username, displayName, role: 'member' } });
});

// Login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '请输入用户名和密码' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) {
    return res.status(400).json({ error: '用户名或密码错误' });
  }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    return res.status(400).json({ error: '用户名或密码错误' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, displayName: user.display_name, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({ token, user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role } });
});

// Get current user info
router.get('/me', authenticateToken, (req, res) => {
  const user = db.prepare('SELECT id, username, display_name, role, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json({ id: user.id, username: user.username, displayName: user.display_name, role: user.role });
});

module.exports = router;
