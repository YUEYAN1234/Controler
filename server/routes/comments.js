const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get comments for a file
router.get('/:fileId', authenticateToken, (req, res) => {
  const comments = db.prepare(`
    SELECT c.*, u.display_name as author_name
    FROM comments c
    LEFT JOIN users u ON c.user_id = u.id
    WHERE c.file_id = ?
    ORDER BY c.created_at DESC
  `).all(req.params.fileId);
  res.json(comments);
});

// Add comment
router.post('/:fileId', authenticateToken, (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: '注释内容不能为空' });

  const result = db.prepare('INSERT INTO comments (file_id, user_id, content) VALUES (?, ?, ?)').run(
    req.params.fileId, req.user.id, content.trim()
  );

  const comment = db.prepare(`
    SELECT c.*, u.display_name as author_name
    FROM comments c
    LEFT JOIN users u ON c.user_id = u.id
    WHERE c.id = ?
  `).get(result.lastInsertRowid);

  res.json(comment);
});

// Delete comment (only own comments)
router.delete('/:id', authenticateToken, (req, res) => {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(req.params.id);
  if (!comment) return res.status(404).json({ error: '注释不存在' });
  if (comment.user_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: '只能删除自己的注释' });
  }

  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
