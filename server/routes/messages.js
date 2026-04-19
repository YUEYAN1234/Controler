const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all messages with reply count
router.get('/', authenticateToken, (req, res) => {
  const messages = db.prepare(`
    SELECT m.*, u.display_name as author_name,
      (SELECT COUNT(*) FROM message_replies r WHERE r.message_id = m.id) as reply_count
    FROM messages m
    LEFT JOIN users u ON m.user_id = u.id
    ORDER BY m.created_at DESC
  `).all();
  res.json(messages);
});

// Post a message
router.post('/', authenticateToken, (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: '留言内容不能为空' });

  const result = db.prepare('INSERT INTO messages (content, user_id) VALUES (?, ?)').run(content.trim(), req.user.id);
  const message = db.prepare(`
    SELECT m.*, u.display_name as author_name, 0 as reply_count
    FROM messages m
    LEFT JOIN users u ON m.user_id = u.id
    WHERE m.id = ?
  `).get(result.lastInsertRowid);
  res.json(message);
});

// Delete a message (own or admin)
router.delete('/:id', authenticateToken, (req, res) => {
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);
  if (!msg) return res.status(404).json({ error: '留言不存在' });
  if (msg.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '只能删除自己的留言' });
  }
  db.prepare('DELETE FROM messages WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Get replies for a message
router.get('/:id/replies', authenticateToken, (req, res) => {
  const replies = db.prepare(`
    SELECT r.*, u.display_name as author_name
    FROM message_replies r
    LEFT JOIN users u ON r.user_id = u.id
    WHERE r.message_id = ?
    ORDER BY r.created_at ASC
  `).all(req.params.id);
  res.json(replies);
});

// Post a reply
router.post('/:id/replies', authenticateToken, (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: '回复内容不能为空' });

  const result = db.prepare('INSERT INTO message_replies (message_id, user_id, content) VALUES (?, ?, ?)').run(
    req.params.id, req.user.id, content.trim()
  );
  const reply = db.prepare(`
    SELECT r.*, u.display_name as author_name
    FROM message_replies r
    LEFT JOIN users u ON r.user_id = u.id
    WHERE r.id = ?
  `).get(result.lastInsertRowid);
  res.json(reply);
});

// Delete a reply (own or admin)
router.delete('/replies/:id', authenticateToken, (req, res) => {
  const reply = db.prepare('SELECT * FROM message_replies WHERE id = ?').get(req.params.id);
  if (!reply) return res.status(404).json({ error: '回复不存在' });
  if (reply.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '只能删除自己的回复' });
  }
  db.prepare('DELETE FROM message_replies WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
