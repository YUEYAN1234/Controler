const express = require('express');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Get all folders (tree)
router.get('/', authenticateToken, (req, res) => {
  const team = req.query.team || 'control';
  const folders = db.prepare(`
    SELECT f.*, u.display_name as creator_name 
    FROM folders f 
    LEFT JOIN users u ON f.created_by = u.id
    WHERE f.team = ?
    ORDER BY f.name
  `).all(team);
  res.json(folders);
});

// Create folder
router.post('/', authenticateToken, (req, res) => {
  const { name, parentId, team } = req.body;
  const t = team || 'control';

  if (!name || !name.trim()) {
    return res.status(400).json({ error: '文件夹名不能为空' });
  }

  // Check if parent exists when parentId is specified
  if (parentId) {
    const parent = db.prepare('SELECT id FROM folders WHERE id = ?').get(parentId);
    if (!parent) return res.status(404).json({ error: '父文件夹不存在' });
  }

  const result = db.prepare('INSERT INTO folders (name, parent_id, created_by, team) VALUES (?, ?, ?, ?)').run(name.trim(), parentId || null, req.user.id, t);
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

// Move folder to another parent
router.patch('/:id/move', authenticateToken, (req, res) => {
  const { targetFolderId } = req.body; // null = move to root
  const folderId = parseInt(req.params.id);

  // Prevent moving folder into itself
  if (targetFolderId === folderId) {
    return res.status(400).json({ error: '不能将文件夹移动到自身内部' });
  }

  // Prevent circular reference: check if target is a descendant
  if (targetFolderId) {
    let curr = targetFolderId;
    while (curr) {
      if (curr === folderId) {
        return res.status(400).json({ error: '不能将文件夹移动到其子文件夹中' });
      }
      const parent = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(curr);
      curr = parent?.parent_id;
    }
  }

  db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(targetFolderId || null, folderId);
  res.json({ success: true });
});

module.exports = router;
