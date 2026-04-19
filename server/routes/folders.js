const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all folders (tree)
router.get('/', authenticateToken, (req, res) => {
  const folders = db.prepare(`
    SELECT f.*, u.display_name as creator_name 
    FROM folders f 
    LEFT JOIN users u ON f.created_by = u.id
    ORDER BY f.name
  `).all();
  res.json(folders);
});

// Create folder
router.post('/', authenticateToken, (req, res) => {
  const { name, parentId } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: '文件夹名不能为空' });
  }

  // Check if parent exists when parentId is specified
  if (parentId) {
    const parent = db.prepare('SELECT id FROM folders WHERE id = ?').get(parentId);
    if (!parent) return res.status(404).json({ error: '父文件夹不存在' });
  }

  const result = db.prepare('INSERT INTO folders (name, parent_id, created_by) VALUES (?, ?, ?)').run(name.trim(), parentId || null, req.user.id);
  const folder = db.prepare('SELECT f.*, u.display_name as creator_name FROM folders f LEFT JOIN users u ON f.created_by = u.id WHERE f.id = ?').get(result.lastInsertRowid);
  res.json(folder);
});

// Rename folder
router.put('/:id', authenticateToken, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '文件夹名不能为空' });

  db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
  res.json({ success: true });
});

// Delete folder
router.delete('/:id', authenticateToken, (req, res) => {
  db.prepare('DELETE FROM folders WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
