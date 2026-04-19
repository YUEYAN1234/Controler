const express = require('express');
const db = require('../db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all announcements
router.get('/', authenticateToken, (req, res) => {
  const announcements = db.prepare(`
    SELECT a.*, u.display_name as author_name, f.original_name as attachment_name, f.size as attachment_size
    FROM announcements a
    LEFT JOIN users u ON a.user_id = u.id
    LEFT JOIN files f ON a.attachment_file_id = f.id
    ORDER BY a.pinned DESC, a.created_at DESC
  `).all();
  res.json(announcements);
});

// Create announcement (admin only)
router.post('/', authenticateToken, requireAdmin, (req, res) => {
  const { title, content, pinned, attachmentFileId } = req.body;
  if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' });

  const result = db.prepare('INSERT INTO announcements (title, content, user_id, pinned, attachment_file_id) VALUES (?, ?, ?, ?, ?)').run(
    title.trim(), content.trim(), req.user.id, pinned ? 1 : 0, attachmentFileId || null
  );

  const announcement = db.prepare(`
    SELECT a.*, u.display_name as author_name, f.original_name as attachment_name, f.size as attachment_size
    FROM announcements a
    LEFT JOIN users u ON a.user_id = u.id
    LEFT JOIN files f ON a.attachment_file_id = f.id
    WHERE a.id = ?
  `).get(result.lastInsertRowid);

  res.json(announcement);
});

// Update announcement (admin only)
router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  const { title, content, pinned, attachmentFileId } = req.body;
  db.prepare('UPDATE announcements SET title = ?, content = ?, pinned = ?, attachment_file_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    title.trim(), content.trim(), pinned ? 1 : 0, attachmentFileId || null, req.params.id
  );
  res.json({ success: true });
});

// Delete announcement (admin only)
router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
