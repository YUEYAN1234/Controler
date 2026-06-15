const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});

const upload = multer({ storage });

function getFolderPath(folderId, foldersById) {
  if (!folderId) return '根目录';

  const parts = [];
  const seen = new Set();
  let currentId = Number(folderId);

  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const folder = foldersById.get(currentId);
    if (!folder) break;
    parts.unshift(folder.name);
    currentId = folder.parent_id;
  }

  return parts.length > 0 ? `根目录 / ${parts.join(' / ')}` : '根目录';
}

// Get files in folder (or root if no folderId)
router.get('/', authenticateToken, (req, res) => {
  const { folderId, team } = req.query;
  const t = team || 'control';
  let files;
  if (folderId) {
    files = db.prepare(`
      SELECT f.*, u.display_name as uploader_name,
        (SELECT COUNT(*) FROM comments c WHERE c.file_id = f.id) as comment_count
      FROM files f 
      LEFT JOIN users u ON f.uploaded_by = u.id 
      WHERE f.folder_id = ? 
      ORDER BY f.sort_order ASC, f.created_at DESC
    `).all(folderId);
  } else {
    files = db.prepare(`
      SELECT f.*, u.display_name as uploader_name,
        (SELECT COUNT(*) FROM comments c WHERE c.file_id = f.id) as comment_count
      FROM files f 
      LEFT JOIN users u ON f.uploaded_by = u.id 
      WHERE f.folder_id IS NULL AND f.team = ?
      ORDER BY f.sort_order ASC, f.created_at DESC
    `).all(t);
  }
  res.json(files);
});

// Upload files
router.post('/upload', authenticateToken, upload.array('files'), (req, res) => {
  const folderId = req.body.folderId || null;
  const team = req.body.team || 'control';
  const insertStmt = db.prepare('INSERT INTO files (original_name, stored_name, size, mime_type, folder_id, uploaded_by, team) VALUES (?, ?, ?, ?, ?, ?, ?)');

  const results = [];
  const insertMany = db.transaction((files) => {
    for (const file of files) {
      const result = insertStmt.run(
        Buffer.from(file.originalname, 'latin1').toString('utf8'),
        file.filename,
        file.size,
        file.mimetype,
        folderId,
        req.user.id,
        team
      );
      results.push({
        id: result.lastInsertRowid,
        original_name: Buffer.from(file.originalname, 'latin1').toString('utf8'),
        stored_name: file.filename,
        size: file.size,
        mime_type: file.mimetype
      });
    }
  });

  insertMany(req.files);
  res.json(results);
});

// Search files across the selected team.
router.get('/search', authenticateToken, (req, res) => {
  const query = String(req.query.q || '').trim();
  const team = String(req.query.team || 'control');
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);

  if (!query) {
    res.json([]);
    return;
  }

  const normalizedQuery = query.toLowerCase();
  const prefixQuery = `${normalizedQuery}%`;
  const fuzzyQuery = `%${normalizedQuery}%`;

  const rows = db.prepare(`
    SELECT f.*, u.display_name as uploader_name, fo.name as folder_name,
      (SELECT COUNT(*) FROM comments c WHERE c.file_id = f.id) as comment_count,
      CASE
        WHEN lower(f.original_name) = ? THEN 0
        WHEN lower(f.original_name) LIKE ? THEN 1
        WHEN lower(COALESCE(fo.name, '')) LIKE ? THEN 2
        WHEN lower(COALESCE(u.display_name, '')) LIKE ? THEN 3
        ELSE 4
      END as search_rank
    FROM files f
    LEFT JOIN users u ON f.uploaded_by = u.id
    LEFT JOIN folders fo ON f.folder_id = fo.id
    WHERE f.team = ? AND (
      lower(f.original_name) LIKE ?
      OR lower(COALESCE(fo.name, '')) LIKE ?
      OR lower(COALESCE(f.mime_type, '')) LIKE ?
      OR lower(COALESCE(u.display_name, '')) LIKE ?
      OR EXISTS (
        SELECT 1 FROM comments c
        WHERE c.file_id = f.id AND lower(c.content) LIKE ?
      )
    )
    ORDER BY search_rank ASC, f.created_at DESC
    LIMIT ?
  `).all(
    normalizedQuery,
    prefixQuery,
    fuzzyQuery,
    fuzzyQuery,
    team,
    fuzzyQuery,
    fuzzyQuery,
    fuzzyQuery,
    fuzzyQuery,
    fuzzyQuery,
    limit
  );

  const folders = db.prepare('SELECT id, name, parent_id FROM folders WHERE team = ?').all(team);
  const foldersById = new Map(folders.map(folder => [folder.id, folder]));

  res.json(rows.map(file => ({
    ...file,
    folder_path: getFolderPath(file.folder_id, foldersById)
  })));
});

// Download file
router.get('/:id/download', authenticateToken, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: '文件不存在' });

  const filePath = path.join(uploadDir, file.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件已丢失' });

  res.download(filePath, file.original_name);
});

// Preview file (serve raw)
router.get('/:id/preview', authenticateToken, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: '文件不存在' });

  const filePath = path.join(uploadDir, file.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件已丢失' });

  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', 'inline');
  fs.createReadStream(filePath).pipe(res);
});

// Move file to folder
router.put('/:id/move', authenticateToken, (req, res) => {
  const { folderId } = req.body;
  db.prepare('UPDATE files SET folder_id = ? WHERE id = ?').run(folderId || null, req.params.id);
  res.json({ success: true });
});

// Delete file
router.delete('/:id', authenticateToken, (req, res) => {
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: '文件不存在' });

  // Delete physical file
  const filePath = path.join(uploadDir, file.stored_name);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  db.prepare('DELETE FROM files WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// Batch download (zip)
router.post('/batch-download', authenticateToken, (req, res) => {
  const { fileIds } = req.body;
  if (!fileIds || !Array.isArray(fileIds) || fileIds.length === 0) {
    return res.status(400).json({ error: '请选择至少一个文件' });
  }

  const archiver = require('archiver');
  const placeholders = fileIds.map(() => '?').join(',');
  const files = db.prepare(`SELECT * FROM files WHERE id IN (${placeholders})`).all(...fileIds);

  if (files.length === 0) return res.status(404).json({ error: '未找到文件' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="batch-download.zip"');

  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.on('error', (err) => res.status(500).json({ error: err.message }));
  archive.pipe(res);

  // Track duplicate filenames
  const nameCount = {};
  for (const file of files) {
    const filePath = path.join(uploadDir, file.stored_name);
    if (fs.existsSync(filePath)) {
      let name = file.original_name;
      if (nameCount[name]) {
        const ext = path.extname(name);
        const base = path.basename(name, ext);
        name = `${base} (${nameCount[name]})${ext}`;
      }
      nameCount[file.original_name] = (nameCount[file.original_name] || 0) + 1;
      archive.file(filePath, { name });
    }
  }

  archive.finalize();
});

// Reorder files
router.post('/reorder', authenticateToken, (req, res) => {
  const { updates } = req.body;
  if (!updates || !Array.isArray(updates)) return res.status(400).json({ error: '无效的数据' });
  const updateStmt = db.prepare('UPDATE files SET sort_order = ? WHERE id = ?');
  const updateMany = db.transaction((items) => {
    for (const item of items) {
      updateStmt.run(item.sort_order, item.id);
    }
  });
  updateMany(updates);
  res.json({ success: true });
});

// Move file to another folder
router.patch('/:id/move', authenticateToken, (req, res) => {
  const { targetFolderId } = req.body; // null = move to root
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(req.params.id);
  if (!file) return res.status(404).json({ error: '文件不存在' });

  db.prepare('UPDATE files SET folder_id = ? WHERE id = ?').run(targetFolderId || null, req.params.id);
  res.json({ success: true });
});

module.exports = router;
