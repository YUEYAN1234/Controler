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

// Get files in folder (or root if no folderId)
router.get('/', authenticateToken, (req, res) => {
  const { folderId } = req.query;
  let files;
  if (folderId) {
    files = db.prepare(`
      SELECT f.*, u.display_name as uploader_name,
        (SELECT COUNT(*) FROM comments c WHERE c.file_id = f.id) as comment_count
      FROM files f 
      LEFT JOIN users u ON f.uploaded_by = u.id 
      WHERE f.folder_id = ? 
      ORDER BY f.created_at DESC
    `).all(folderId);
  } else {
    files = db.prepare(`
      SELECT f.*, u.display_name as uploader_name,
        (SELECT COUNT(*) FROM comments c WHERE c.file_id = f.id) as comment_count
      FROM files f 
      LEFT JOIN users u ON f.uploaded_by = u.id 
      WHERE f.folder_id IS NULL 
      ORDER BY f.created_at DESC
    `).all();
  }
  res.json(files);
});

// Upload files
router.post('/upload', authenticateToken, upload.array('files'), (req, res) => {
  const folderId = req.body.folderId || null;
  const insertStmt = db.prepare('INSERT INTO files (original_name, stored_name, size, mime_type, folder_id, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)');

  const results = [];
  const insertMany = db.transaction((files) => {
    for (const file of files) {
      const result = insertStmt.run(
        Buffer.from(file.originalname, 'latin1').toString('utf8'),
        file.filename,
        file.size,
        file.mimetype,
        folderId,
        req.user.id
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

module.exports = router;
