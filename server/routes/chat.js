const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_BASE = 'https://api.deepseek.com';

const fs = require('fs');
const path = require('path');
const multer = require('multer');
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const xlsx = require('xlsx');
const WordExtractor = require('word-extractor');
const { v4: uuidv4 } = require('uuid');
const { createWorker } = require('tesseract.js');

const READABLE_FILE_EXTS = new Set(['.txt', '.md', '.json', '.js', '.html', '.css', '.csv', '.xml', '.pdf', '.doc', '.docx', '.xlsx', '.xls']);
const CHAT_ATTACHMENT_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv',
  '.txt', '.md', '.json', '.html', '.css', '.js', '.xml'
]);
const CHAT_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff']);
const GENERIC_FILE_TERMS = new Set(['文件', '文档', '内容', '介绍', '分析', '读取', '查看', '看看', '这个', '那个', '一下', 'pdf', 'word', 'excel']);
const FILE_QUERY_LIMIT = 300;
const FILE_CONTEXT_LIMIT = 30;
const MAX_AUTO_INJECT_FILES = 3;
const MAX_FILE_CONTENT_LEN = 150000;
const MAX_CHAT_ATTACHMENT_FILES = 8;
const MAX_CHAT_ATTACHMENT_SIZE = 20 * 1024 * 1024;
const MAX_CHAT_ATTACHMENT_TEXT_LEN = 50000;
const MAX_CHAT_ATTACHMENT_CONTEXT_LEN = 120000;
const DEFAULT_ATTACHMENT_PROMPT = '请根据我上传的附件进行分析和回答。';
const OCR_LANGUAGES = (process.env.CHAT_OCR_LANGS || 'eng,chi_sim')
  .split(/[+,]/)
  .map(lang => lang.trim())
  .filter(Boolean);

let ocrWorkerPromise = null;
let ocrQueue = Promise.resolve();
const wordExtractor = new WordExtractor();

function getUploadDir() {
  return process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
}

function getChatAttachmentDir() {
  const dir = path.join(getUploadDir(), 'chat-attachments');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function normalizeUploadName(name) {
  const raw = String(name || 'attachment');
  if (/[^\u0000-\u00ff]/.test(raw)) return raw;
  try {
    const decoded = Buffer.from(raw, 'latin1').toString('utf8');
    return decoded.includes('\ufffd') ? raw : decoded;
  } catch (e) {
    return raw;
  }
}

function formatBytes(size) {
  const value = Number(size) || 0;
  if (value < 1024) return `${value}B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${(value / 1024 / 1024).toFixed(1)}MB`;
}

function getAttachmentKind(fileName, mimeType = '') {
  const ext = path.extname(fileName || '').toLowerCase();
  if (CHAT_IMAGE_EXTS.has(ext) || String(mimeType).startsWith('image/')) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (['.doc', '.docx'].includes(ext)) return 'word';
  if (['.xls', '.xlsx', '.csv'].includes(ext)) return 'excel';
  return 'text';
}

function isSupportedChatAttachment(fileName, mimeType = '') {
  const ext = path.extname(fileName || '').toLowerCase();
  return CHAT_ATTACHMENT_EXTS.has(ext) || String(mimeType).startsWith('image/');
}

const chatAttachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, getChatAttachmentDir()),
  filename: (req, file, cb) => {
    const originalName = normalizeUploadName(file.originalname);
    const ext = path.extname(originalName).toLowerCase();
    cb(null, `${uuidv4()}${CHAT_ATTACHMENT_EXTS.has(ext) ? ext : ''}`);
  }
});

const chatAttachmentUpload = multer({
  storage: chatAttachmentStorage,
  limits: {
    files: MAX_CHAT_ATTACHMENT_FILES,
    fileSize: MAX_CHAT_ATTACHMENT_SIZE
  },
  fileFilter: (req, file, cb) => {
    const originalName = normalizeUploadName(file.originalname);
    if (!isSupportedChatAttachment(originalName, file.mimetype)) {
      cb(new Error(`暂不支持附件格式：${path.extname(originalName) || file.mimetype || '未知格式'}`));
      return;
    }
    cb(null, true);
  }
}).array('attachments', MAX_CHAT_ATTACHMENT_FILES);

function parseChatMultipart(req, res, next) {
  if (!req.is('multipart/form-data')) {
    next();
    return;
  }

  chatAttachmentUpload(req, res, (err) => {
    if (!err) {
      next();
      return;
    }

    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: `单个附件不能超过 ${formatBytes(MAX_CHAT_ATTACHMENT_SIZE)}` });
      return;
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).json({ error: `一次最多上传 ${MAX_CHAT_ATTACHMENT_FILES} 个附件` });
      return;
    }
    res.status(400).json({ error: err.message || '附件上传失败' });
  });
}

function parseChatRequestBody(req) {
  if (typeof req.body?.payload === 'string') {
    try {
      return JSON.parse(req.body.payload);
    } catch (e) {
      throw new Error('聊天请求参数格式错误');
    }
  }
  return req.body || {};
}

function getFilesForTeam(team, limit = FILE_QUERY_LIMIT) {
  const baseSql = `
    SELECT f.*, u.display_name as uploader, fo.name as folder_name
    FROM files f
    LEFT JOIN users u ON f.uploaded_by = u.id
    LEFT JOIN folders fo ON f.folder_id = fo.id
  `;

  if (team && team !== 'all') {
    return db.prepare(`${baseSql} WHERE f.team = ? ORDER BY f.created_at DESC LIMIT ?`).all(team, limit);
  }
  return db.prepare(`${baseSql} ORDER BY f.created_at DESC LIMIT ?`).all(limit);
}

function normalizeSearchText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[®™]/g, '')
    .replace(/\.(pdf|docx?|xlsx?|xls|txt|md|csv|json|html|css|xml)\b/g, ' $1 ')
    .replace(/[_\-–—+()[\]{}.,，。、《》<>:：;；!！?？"'“”‘’/\\|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactSearchText(value) {
  return normalizeSearchText(value).replace(/\s+/g, '');
}

function getSearchTerms(value) {
  const terms = new Set();
  const tokens = normalizeSearchText(value).match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) || [];

  for (const token of tokens) {
    if (token.length >= 2) terms.add(token);
    if (/^[\u4e00-\u9fff]+$/.test(token) && token.length > 2) {
      for (let i = 0; i < token.length - 1; i++) {
        terms.add(token.slice(i, i + 2));
      }
    }
  }

  return [...terms].filter(term => !GENERIC_FILE_TERMS.has(term));
}

function scoreFileMatch(query, file) {
  const queryNorm = normalizeSearchText(query);
  if (!queryNorm) return 0;

  const fileName = file.original_name || '';
  const nameNorm = normalizeSearchText(fileName);
  const queryCompact = compactSearchText(query);
  const nameCompact = compactSearchText(fileName);
  const ext = path.extname(fileName).toLowerCase();
  let score = 0;

  if (fileName === query) score += 1000;
  if (nameNorm.includes(queryNorm) || nameCompact.includes(queryCompact)) score += 150;
  if (queryNorm.includes(ext.slice(1)) || queryCompact.includes(ext.slice(1))) score += 12;
  if ((queryNorm.includes('pdf') || queryCompact.includes('pdf')) && ext !== '.pdf') score -= 30;

  for (const term of getSearchTerms(query)) {
    if (nameNorm.includes(term) || nameCompact.includes(term)) {
      score += /\d/.test(term) ? 12 : 8;
    }
  }

  if (!READABLE_FILE_EXTS.has(ext)) score -= 20;
  return score;
}

function findMentionedFiles(query, files, limit = MAX_AUTO_INJECT_FILES) {
  return files
    .map(file => ({ file, score: scoreFileMatch(query, file) }))
    .filter(item => item.score >= 18)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.file);
}

function findBestFile(fileName, team) {
  const files = getFilesForTeam(team, FILE_QUERY_LIMIT);
  const exact = files.find(file => file.original_name === fileName);
  if (exact) return exact;
  return findMentionedFiles(fileName, files, 1)[0];
}

async function extractPdfText(filePath) {
  const dataBuffer = fs.readFileSync(filePath);

  if (pdfParse.PDFParse) {
    const parser = new pdfParse.PDFParse({ data: dataBuffer });
    try {
      const result = await parser.getText();
      return result.text || '';
    } finally {
      await parser.destroy();
    }
  }

  if (typeof pdfParse === 'function') {
    const result = await pdfParse(dataBuffer);
    return result.text || '';
  }

  throw new Error('当前 pdf-parse 版本不支持文本提取');
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker(OCR_LANGUAGES.length > 0 ? OCR_LANGUAGES : 'eng', undefined, {
      logger: () => {}
    }).then(async (worker) => {
      try {
        await worker.setParameters({ preserve_interword_spaces: '1' });
      } catch (e) {
        // Keep OCR usable even if the parameter is not supported by the runtime.
      }
      return worker;
    }).catch((err) => {
      ocrWorkerPromise = null;
      throw err;
    });
  }
  return ocrWorkerPromise;
}

async function recognizeImageText(filePath) {
  const run = async () => {
    const worker = await getOcrWorker();
    const result = await worker.recognize(filePath);
    return result.data?.text || '';
  };

  const resultPromise = ocrQueue.then(run, run);
  ocrQueue = resultPromise.catch(() => {});
  return resultPromise;
}

function limitText(text, limit) {
  const value = String(text || '').trim();
  if (value.length <= limit) return { text: value, truncated: false };
  return { text: value.slice(0, limit), truncated: true };
}

function extractWorkbookText(filePath) {
  const workbook = xlsx.readFile(filePath, { cellDates: true });
  return workbook.SheetNames.slice(0, 10).map((sheetName) => {
    const csv = xlsx.utils.sheet_to_csv(workbook.Sheets[sheetName]);
    return `【工作表：${sheetName}】\n${csv}`;
  }).join('\n\n');
}

async function readChatAttachmentContent(filePath, mimeType, originalName) {
  const ext = path.extname(originalName).toLowerCase();
  const kind = getAttachmentKind(originalName, mimeType);

  if (kind === 'image') {
    const ocrText = await recognizeImageText(filePath);
    if (!ocrText.trim()) {
      return {
        text: '',
        status: 'warning',
        note: '图片已上传，但 OCR 未识别出可用文字；如果需要分析图片细节，请上传更清晰的文字图片或转换为 PDF/文档。'
      };
    }
    return { text: ocrText, status: 'ready', note: '已通过 OCR 提取图片文字' };
  }

  if (['.txt', '.md', '.json', '.js', '.html', '.css', '.csv', '.xml'].includes(ext)) {
    return { text: fs.readFileSync(filePath, 'utf-8'), status: 'ready', note: '已读取文本内容' };
  }
  if (ext === '.pdf') {
    const text = await extractPdfText(filePath);
    if (!text.trim()) {
      return {
        text: '',
        status: 'warning',
        note: 'PDF 已读取，但没有提取到可复制文本；可能是扫描版图片 PDF。'
      };
    }
    return { text, status: 'ready', note: '已提取 PDF 文本' };
  }
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return { text: result.value, status: 'ready', note: '已提取 Word 文本' };
  }
  if (ext === '.doc') {
    const doc = await wordExtractor.extract(filePath);
    return { text: doc.getBody(), status: 'ready', note: '已提取 Word 文本' };
  }
  if (['.xlsx', '.xls'].includes(ext)) {
    return { text: extractWorkbookText(filePath), status: 'ready', note: '已提取 Excel 工作表内容' };
  }

  return {
    text: '',
    status: 'warning',
    note: `不支持读取此文件格式 (${ext || mimeType || '未知格式'})。`
  };
}

async function processChatAttachments(files = []) {
  const results = [];

  for (const file of files) {
    const originalName = normalizeUploadName(file.originalname);
    const base = {
      name: originalName,
      storedName: file.filename,
      size: file.size,
      mimeType: file.mimetype || '',
      kind: getAttachmentKind(originalName, file.mimetype),
      status: 'ready',
      note: '',
      text: '',
      truncated: false
    };

    try {
      const content = await readChatAttachmentContent(file.path, file.mimetype, originalName);
      const limited = limitText(content.text, MAX_CHAT_ATTACHMENT_TEXT_LEN);
      results.push({
        ...base,
        status: content.status || 'ready',
        note: content.note || '',
        text: limited.text,
        truncated: limited.truncated
      });
    } catch (e) {
      results.push({
        ...base,
        status: 'error',
        note: `读取失败：${e.message}`,
        text: ''
      });
    }
  }

  return results;
}

function parseAttachmentJson(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function toPublicAttachment(attachment) {
  const textPreview = String(attachment.text || '').slice(0, 240);
  return {
    name: attachment.name || attachment.originalName || '附件',
    size: attachment.size || 0,
    mimeType: attachment.mimeType || '',
    kind: attachment.kind || getAttachmentKind(attachment.name || '', attachment.mimeType || ''),
    status: attachment.status || 'ready',
    note: attachment.note || '',
    textPreview,
    truncated: Boolean(attachment.truncated)
  };
}

function formatAttachmentContext(title, attachments = [], maxLen = MAX_CHAT_ATTACHMENT_CONTEXT_LEN) {
  if (!attachments.length) return '';

  let remaining = maxLen;
  const sections = [];

  attachments.forEach((attachment, index) => {
    if (remaining <= 0) return;

    const header = `${index + 1}. ${attachment.name}（${formatBytes(attachment.size)}，${attachment.kind}）`;
    const note = attachment.note ? `读取状态：${attachment.note}` : `读取状态：${attachment.status || 'ready'}`;
    const text = String(attachment.text || '').trim();

    if (!text) {
      sections.push(`${header}\n${note}`);
      return;
    }

    const clipped = text.length > remaining ? text.slice(0, remaining) : text;
    remaining -= clipped.length;
    const truncatedNote = attachment.truncated || clipped.length < text.length ? '\n[附件内容已截断]' : '';
    sections.push(`${header}\n${note}\n${clipped}${truncatedNote}`);
  });

  return sections.length > 0 ? `【${title}】\n${sections.join('\n\n')}` : '';
}

function getSessionAttachmentContext(sessionId, userId) {
  if (!sessionId) return '';

  const rows = db.prepare(`
    SELECT m.attachments_json
    FROM chat_messages m
    JOIN chat_sessions s ON s.id = m.session_id
    WHERE m.session_id = ? AND s.user_id = ? AND m.role = 'user'
      AND m.attachments_json IS NOT NULL AND m.attachments_json != '[]'
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT 8
  `).all(sessionId, userId);

  const attachments = rows
    .flatMap(row => parseAttachmentJson(row.attachments_json))
    .filter(attachment => attachment && attachment.name);

  return formatAttachmentContext('本会话已上传附件内容', attachments);
}

async function readStoredFileContent(file) {
  const uploadDir = getUploadDir();
  const filePath = path.join(uploadDir, file.stored_name);
  if (!fs.existsSync(filePath)) return `文件 ${file.original_name} 在服务器上已丢失。`;

  const ext = path.extname(file.original_name).toLowerCase();

  if (['.txt', '.md', '.json', '.js', '.html', '.css', '.csv', '.xml'].includes(ext)) {
    return fs.readFileSync(filePath, 'utf-8').slice(0, MAX_FILE_CONTENT_LEN);
  } else if (ext === '.pdf') {
    const text = await extractPdfText(filePath);
    return (text.trim() || 'PDF 已读取，但没有提取到可复制的文本内容。可能是扫描版图片 PDF。').slice(0, MAX_FILE_CONTENT_LEN);
  } else if (ext === '.docx') {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.slice(0, MAX_FILE_CONTENT_LEN);
  } else if (ext === '.doc') {
    const doc = await wordExtractor.extract(filePath);
    return doc.getBody().slice(0, MAX_FILE_CONTENT_LEN);
  } else if (['.xlsx', '.xls'].includes(ext)) {
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const csv = xlsx.utils.sheet_to_csv(workbook.Sheets[sheetName]);
    return csv.slice(0, MAX_FILE_CONTENT_LEN);
  }
  return `不支持读取此文件格式 (${ext})，只能读取文本、PDF、Word 或 Excel 格式的文件。`;
}

// 读取文件内容的工具函数
async function readFileContent(fileName, options = {}) {
  try {
    const team = options.team || 'all';
    const file = options.file || findBestFile(fileName, team);
    if (!file) {
      const candidates = findMentionedFiles(fileName, getFilesForTeam(team, 20), 5);
      const hint = candidates.length > 0
        ? `可能相关的文件：${candidates.map(f => f.original_name).join('、')}`
        : '请确保文件名准确，或提供文件名中的年份、关键词和格式（例如：2026 规则 pdf）。';
      return `文件 ${fileName} 未找到。${hint}`;
    }

    const content = await readStoredFileContent(file);
    const matchedNote = file.original_name === fileName ? '' : `已根据关键词匹配到文件：${file.original_name}\n\n`;
    return `${matchedNote}${content}`;
  } catch (e) {
    return `读取文件失败: ${e.message}`;
  }
}

// 收集平台上下文信息并自动注入用户提到的文件内容
async function gatherContext(messages, team) {
  const parts = [];

  // 最近公告
  try {
    const announcements = db.prepare(`
      SELECT a.title, a.content, u.display_name as author, a.created_at
      FROM announcements a LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC LIMIT 10
    `).all();
    if (announcements.length > 0) {
      parts.push('【近期公告】\n' + announcements.map(a =>
        `- ${a.title}（${a.author}，${a.created_at}）：${a.content.slice(0, 200)}`
      ).join('\n'));
    }
  } catch (e) { /* ignore */ }

  // 最近及未来的实验室预约（按组过滤）
  try {
    const today = new Date().toISOString().slice(0, 10);
    let reservations;
    if (team && team !== 'all') {
      reservations = db.prepare(`
        SELECT r.date, r.start_time, r.end_time, r.experimenter, r.purpose, r.team, u.display_name as booker
        FROM lab_reservations r LEFT JOIN users u ON r.user_id = u.id
        WHERE r.date >= ? AND r.team = ? ORDER BY r.date, r.start_time LIMIT 30
      `).all(today, team);
    } else {
      reservations = db.prepare(`
        SELECT r.date, r.start_time, r.end_time, r.experimenter, r.purpose, r.team, u.display_name as booker
        FROM lab_reservations r LEFT JOIN users u ON r.user_id = u.id
        WHERE r.date >= ? ORDER BY r.date, r.start_time LIMIT 30
      `).all(today);
    }
    if (reservations.length > 0) {
      const label = team && team !== 'all' ? (team === 'power' ? '\u52a8\u529b\u7ec4' : '\u63a7\u5236\u7ec4') : '';
      parts.push(`\u3010\u5b9e\u9a8c\u5ba4\u9884\u7ea6${label ? '\uff08' + label + '\uff09' : '\uff08\u4eca\u5929\u53ca\u4e4b\u540e\uff09'}\u3011\n` + reservations.map(r =>
        `- [${r.team === 'power' ? '\u52a8\u529b\u7ec4' : '\u63a7\u5236\u7ec4'}] ${r.date} ${r.start_time}-${r.end_time} | \u5b9e\u9a8c\u4eba\u5458: ${r.experimenter} | \u76ee\u7684: ${r.purpose || '\u672a\u586b'} | \u9884\u7ea6\u4eba: ${r.booker}`
      ).join('\n'));
    }
  } catch (e) { /* ignore */ }

  // 最近留言
  try {
    const msgs = db.prepare(`
      SELECT m.content, u.display_name as author, m.created_at
      FROM messages m LEFT JOIN users u ON m.user_id = u.id
      ORDER BY m.created_at DESC LIMIT 10
    `).all();
    if (msgs.length > 0) {
      parts.push('【最近交流板留言】\n' + msgs.map(m =>
        `- ${m.author}（${m.created_at}）：${m.content.slice(0, 150)}`
      ).join('\n'));
    }
  } catch (e) { /* ignore */ }

  // 文件列表及自动内容注入（按组过滤）
  try {
    const searchableFiles = getFilesForTeam(team, FILE_QUERY_LIMIT);
    const files = searchableFiles.slice(0, FILE_CONTEXT_LIMIT);

    if (files.length > 0) {
      parts.push('【文件管理 - 最近上传的文件】\n' + files.map(f =>
        `- [${f.team === 'power' ? '动力组' : '控制组'}] ${f.folder_name ? '[' + f.folder_name + '] ' : ''}${f.original_name}（${(f.size / 1024).toFixed(1)}KB, 上传者: ${f.uploader}, ${f.created_at}）`
      ).join('\n'));

      // 智能拦截：检查用户最新消息是否提到某个文件
      if (messages && messages.length > 0) {
        const lastUserMessage = messages[messages.length - 1].content;
        const matchedFiles = findMentionedFiles(lastUserMessage, searchableFiles);
        for (const f of matchedFiles) {
          console.log('Auto-injecting file content for:', f.original_name);
          const content = await readFileContent(f.original_name, { file: f, team });
          parts.push(`【系统自动读取：文件 ${f.original_name} 的具体内容】\n${content}`);
        }
      }
    }
  } catch (e) { console.error('Error reading files:', e); }

  return parts.join('\n\n');
}

function normalizeChatTeam(team) {
  return ['control', 'power', 'all'].includes(team) ? team : 'all';
}

function makeSessionTitle(text) {
  const title = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 36);
  return title || '新的对话';
}

function getOwnedSession(sessionId, userId) {
  const id = Number(sessionId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return db.prepare('SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?').get(id, userId);
}

function createChatSession(userId, firstMessage, team) {
  const result = db.prepare(`
    INSERT INTO chat_sessions (user_id, title, team)
    VALUES (?, ?, ?)
  `).run(userId, makeSessionTitle(firstMessage), normalizeChatTeam(team));
  return result.lastInsertRowid;
}

function saveChatExchange(sessionId, userId, userContent, assistantContent, team, attachments = []) {
  const attachmentsJson = JSON.stringify(attachments);
  const save = db.transaction(() => {
    db.prepare(`
      INSERT INTO chat_messages (session_id, user_id, role, content, attachments_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, userId, 'user', userContent, attachmentsJson);

    db.prepare(`
      INSERT INTO chat_messages (session_id, user_id, role, content, attachments_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, userId, 'assistant', assistantContent, '[]');

    db.prepare(`
      UPDATE chat_sessions
      SET team = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(normalizeChatTeam(team), sessionId, userId);
  });

  save();
}

function createChatHttpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function requireDeepSeekApiKey() {
  if (!DEEPSEEK_API_KEY) {
    throw createChatHttpError(500, 'AI 服务未配置：请设置 DEEPSEEK_API_KEY');
  }
  return DEEPSEEK_API_KEY;
}

async function prepareChatRuntime(req, reportStatus = () => {}) {
  reportStatus({ phase: 'request', label: '正在接收请求', detail: '解析消息和附件' });
  const body = parseChatRequestBody(req);
  const uploadedFiles = Array.isArray(req.files) ? req.files : [];
  const requestMessages = Array.isArray(body.messages)
    ? body.messages
      .filter(msg => msg && ['system', 'user', 'assistant'].includes(msg.role))
      .map(msg => ({ role: msg.role, content: String(msg.content || '') }))
    : [];

  if (requestMessages.length === 0 && uploadedFiles.length === 0) {
    throw createChatHttpError(400, '消息不能为空');
  }

  let latestUserMessage = [...requestMessages]
    .reverse()
    .find(msg => msg?.role === 'user' && typeof msg.content === 'string' && msg.content.trim());
  if (!latestUserMessage && uploadedFiles.length > 0) {
    latestUserMessage = { role: 'user', content: DEFAULT_ATTACHMENT_PROMPT };
    requestMessages.push(latestUserMessage);
  }
  if (!latestUserMessage) {
    throw createChatHttpError(400, '用户消息不能为空');
  }

  let existingSession = null;
  if (body.sessionId) {
    reportStatus({ phase: 'session', label: '正在读取会话', detail: `会话 ${body.sessionId}` });
    existingSession = getOwnedSession(body.sessionId, req.user.id);
    if (!existingSession) throw createChatHttpError(404, '会话不存在');
  }

  const chatTeam = normalizeChatTeam(body.team || existingSession?.team || 'all');
  reportStatus({
    phase: 'attachments',
    label: '正在处理附件',
    detail: uploadedFiles.length > 0 ? `共 ${uploadedFiles.length} 个附件` : '没有上传附件'
  });
  const chatAttachments = await processChatAttachments(uploadedFiles);
  reportStatus({ phase: 'context', label: '正在收集平台上下文', detail: '读取文件、公告和预约信息' });
  const platformContext = await gatherContext(requestMessages, chatTeam);
  const previousAttachmentContext = getSessionAttachmentContext(existingSession?.id, req.user.id);
  const currentAttachmentContext = formatAttachmentContext('用户本轮上传附件内容', chatAttachments);
  const context = [platformContext, previousAttachmentContext, currentAttachmentContext].filter(Boolean).join('\n\n');
  const userName = db.prepare('SELECT display_name FROM users WHERE id = ?').get(req.user.id);
  const teamLabel = chatTeam === 'control' ? '控制组' : chatTeam === 'power' ? '动力组' : '公共（控制组+动力组）';
  reportStatus({ phase: 'model', label: '正在连接 AI', detail: '准备生成回答' });

  const systemPrompt = `你是 Conter，天津大学 Chem-E-Car 实验数据平台的 AI 助手。
你同时服务两个组：
- **控制组**：负责小车的控制系统，包括传感器、单片机（Arduino/STM32）、控制算法、RS485 通信等
- **动力组**：负责小车的化学动力系统，包括化学电池、电化学测试等

当前模式：${teamLabel}
当前用户：${userName?.display_name || '未知'}
当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}

以下是平台的实时数据与附件上下文（平台数据已按当前模式过滤）：

${context}

回答要求：
- 使用简体中文回答
- 回答简洁准确
- 使用 Markdown 做清晰排版：标题、列表、加粗、表格、代码块按需使用；涉及对比、参数、清单时优先用表格
- 涉及流程图、框图、结构图时优先使用表格或对齐良好的等宽代码块；如果使用字符图，请保持列宽和箭头对齐
- 当前模式为"${teamLabel}"，你**只能基于上面提供的数据回答**，不要编造其他组的信息
- 如果用户询问某个文件，请仔细查看上下文中的【系统自动读取：文件 xxx 的具体内容】部分并据此回答
- 如果用户上传了附件，请优先依据【用户本轮上传附件内容】和【本会话已上传附件内容】回答；图片附件来自 OCR 文本，无法确认非文字细节时要明确说明
- 根据当前模式给予对应方向的技术指导（控制组→电路/编程/通信，动力组→化学/电池/反应，公共→综合两组）`;

  const tools = [
    {
      type: "function",
      function: {
        name: "read_file_content",
        description: "读取平台中已上传文件的具体文本内容。当用户询问某个文件的细节或要求分析某个文件时使用此工具。",
        parameters: {
          type: "object",
          properties: {
            file_name: {
              type: "string",
              description: "文件的原始名称（如 data.txt, report.pdf）。请严格匹配【文件管理】列表中提供的文件名。"
            }
          },
          required: ["file_name"]
        }
      }
    }
  ];

  return {
    existingSession,
    latestUserMessage,
    chatTeam,
    chatAttachments,
    apiMessages: [
      { role: 'system', content: systemPrompt },
      ...requestMessages.slice(-20)
    ],
    tools
  };
}

function writeStreamEvent(res, event, data) {
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch (e) {
    // The client may have stopped the stream.
  }
}

async function* readSseEvents(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() || '';

    for (const event of events) {
      const data = event
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')
        .trim();
      if (!data) continue;
      if (data === '[DONE]') return;
      yield JSON.parse(data);
    }
  }

  const finalData = buffer
    .split(/\r?\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n')
    .trim();
  if (finalData && finalData !== '[DONE]') yield JSON.parse(finalData);
}

function collectToolCallDelta(toolCalls, deltaCalls = []) {
  for (const deltaCall of deltaCalls) {
    const index = Number.isInteger(deltaCall.index) ? deltaCall.index : toolCalls.length;
    const current = toolCalls[index] || {
      id: '',
      type: 'function',
      function: { name: '', arguments: '' }
    };

    if (deltaCall.id) current.id = deltaCall.id;
    if (deltaCall.type) current.type = deltaCall.type;
    if (deltaCall.function?.name) current.function.name += deltaCall.function.name;
    if (deltaCall.function?.arguments) current.function.arguments += deltaCall.function.arguments;

    toolCalls[index] = current;
  }
}

async function appendToolResults(apiMessages, toolCalls, chatTeam, assistantMeta = {}, reportStatus = () => {}) {
  const normalizedToolCalls = toolCalls.filter(Boolean).map((toolCall, index) => ({
    id: toolCall.id || `tool-call-${Date.now()}-${index}`,
    type: toolCall.type || 'function',
    function: {
      name: toolCall.function?.name || '',
      arguments: toolCall.function?.arguments || '{}'
    }
  }));

  const assistantToolMessage = {
    role: 'assistant',
    content: assistantMeta.content || null,
    tool_calls: normalizedToolCalls
  };
  if (assistantMeta.reasoningContent) {
    assistantToolMessage.reasoning_content = assistantMeta.reasoningContent;
  }
  apiMessages.push(assistantToolMessage);

  for (const toolCall of normalizedToolCalls) {
    if (toolCall.function.name !== 'read_file_content') continue;
    try {
      const args = JSON.parse(toolCall.function.arguments || '{}');
      console.log('AI is reading file:', args.file_name);
      reportStatus({
        phase: 'tool',
        label: '正在读取相关文件',
        detail: args.file_name || '平台文件'
      });
      const content = await readFileContent(args.file_name, { team: chatTeam });
      apiMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content
      });
    } catch (e) {
      apiMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: '工具调用参数解析失败'
      });
    }
  }
}

async function streamChatCompletion(apiMessages, tools, chatTeam, res, signal, isClientClosed, onDelta = () => {}, reportStatus = () => {}) {
  let finalReply = '';
  const apiKey = requireDeepSeekApiKey();

  for (let i = 0; i < 3; i++) {
    reportStatus({
      phase: i === 0 ? 'model' : 'model-followup',
      label: i === 0 ? '正在生成回答' : '正在结合文件继续回答',
      detail: i === 0 ? '等待 AI 返回内容' : '已获得文件内容'
    });
    const response = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-v4-pro',
        messages: apiMessages,
        temperature: 0.7,
        max_tokens: 8192,
        stream: true,
        tools
      })
    });

    if (!response.ok) {
      const errData = await response.text();
      console.error('DeepSeek API error:', response.status, errData);
      throw createChatHttpError(502, 'AI 服务暂时不可用，请稍后重试');
    }

    const toolCalls = [];
    let assistantToolContent = '';
    let assistantReasoningContent = '';

    for await (const event of readSseEvents(response)) {
      if (isClientClosed()) throw createChatHttpError(499, '客户端已停止输出');

      const delta = event.choices?.[0]?.delta || {};
      if (delta.reasoning_content) {
        assistantReasoningContent += delta.reasoning_content;
      }
      if (delta.content) {
        finalReply += delta.content;
        assistantToolContent += delta.content;
        onDelta(delta.content, finalReply);
        writeStreamEvent(res, 'delta', { content: delta.content });
      }
      if (delta.tool_calls) {
        collectToolCallDelta(toolCalls, delta.tool_calls);
      }
    }

    if (toolCalls.some(Boolean)) {
      await appendToolResults(apiMessages, toolCalls, chatTeam, {
        content: assistantToolContent,
        reasoningContent: assistantReasoningContent
      }, reportStatus);
      continue;
    }

    if (!finalReply) {
      finalReply = '抱歉，未能生成有效的回答。';
      reportStatus({ phase: 'finalize', label: '正在整理输出', detail: '准备显示回答' });
      onDelta(finalReply, finalReply);
      writeStreamEvent(res, 'delta', { content: finalReply });
    }
    return finalReply;
  }

  if (!finalReply) {
    finalReply = '已处理请求，但未生成内容。';
    reportStatus({ phase: 'finalize', label: '正在整理输出', detail: '准备显示回答' });
    onDelta(finalReply, finalReply);
    writeStreamEvent(res, 'delta', { content: finalReply });
  }
  return finalReply;
}

router.get('/sessions', authenticateToken, (req, res) => {
  try {
    const sessions = db.prepare(`
      SELECT
        s.id,
        s.title,
        s.team,
        s.created_at,
        s.updated_at,
        (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) as message_count,
        (SELECT m.content FROM chat_messages m WHERE m.session_id = s.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) as last_message
      FROM chat_sessions s
      WHERE s.user_id = ?
      ORDER BY s.updated_at DESC, s.id DESC
      LIMIT 60
    `).all(req.user.id);

    res.json(sessions);
  } catch (err) {
    console.error('Chat sessions error:', err);
    res.status(500).json({ error: '读取历史会话失败: ' + err.message });
  }
});

router.get('/sessions/:id', authenticateToken, (req, res) => {
  try {
    const session = getOwnedSession(req.params.id, req.user.id);
    if (!session) return res.status(404).json({ error: '会话不存在' });

    const rows = db.prepare(`
      SELECT id, role, content, attachments_json, created_at
      FROM chat_messages
      WHERE session_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(session.id);

    const messages = rows.map(row => ({
      id: row.id,
      role: row.role,
      content: row.content,
      created_at: row.created_at,
      attachments: parseAttachmentJson(row.attachments_json).map(toPublicAttachment)
    }));

    res.json({ session, messages });
  } catch (err) {
    console.error('Chat session detail error:', err);
    res.status(500).json({ error: '读取会话详情失败: ' + err.message });
  }
});

// Streaming chat endpoint
router.post('/stream', authenticateToken, parseChatMultipart, async (req, res) => {
  let clientClosed = false;
  let streamFinished = false;
  let runtime = null;
  let finalSessionId = null;
  let reply = '';
  const upstreamController = new AbortController();

  const handleClientClose = () => {
    if (!streamFinished) {
      clientClosed = true;
      upstreamController.abort();
    }
  };
  req.on('aborted', handleClientClose);
  res.on('close', handleClientClose);

  try {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();

    const reportStatus = (status) => {
      writeStreamEvent(res, 'status', {
        phase: status.phase,
        label: status.label,
        detail: status.detail || '',
        at: new Date().toISOString()
      });
    };

    runtime = await prepareChatRuntime(req, reportStatus);
    if (clientClosed) return;

    reportStatus({ phase: 'session', label: '正在保存会话', detail: runtime.existingSession ? '继续当前会话' : '创建新会话' });
    finalSessionId = runtime.existingSession?.id || createChatSession(
      req.user.id,
      runtime.latestUserMessage.content,
      runtime.chatTeam
    );

    writeStreamEvent(res, 'session', { sessionId: finalSessionId });
    writeStreamEvent(res, 'attachments', {
      attachments: runtime.chatAttachments.map(toPublicAttachment)
    });

    reply = await streamChatCompletion(
      [...runtime.apiMessages],
      runtime.tools,
      runtime.chatTeam,
      res,
      upstreamController.signal,
      () => clientClosed,
      (_chunk, currentReply) => {
        reply = currentReply;
      },
      reportStatus
    );

    if (!clientClosed && reply) {
      reportStatus({ phase: 'done', label: '回答完成', detail: '正在显示结果' });
      writeStreamEvent(res, 'done', { sessionId: finalSessionId });
    }
  } catch (err) {
    const stopped = clientClosed || err.name === 'AbortError' || err.status === 499;
    if (!stopped) {
      console.error('Streaming chat error:', err);
      if (!res.headersSent) {
        res.status(err.status || 500).json({ error: err.message || '服务器错误' });
        return;
      }
      writeStreamEvent(res, 'error', {
        error: err.status === 502 ? err.message : ('服务器错误: ' + err.message)
      });
    }
  } finally {
    if (runtime && finalSessionId && (reply || clientClosed)) {
      const savedReply = reply || '（已停止输出）';
      try {
        saveChatExchange(
          finalSessionId,
          req.user.id,
          runtime.latestUserMessage.content,
          savedReply,
          runtime.chatTeam,
          runtime.chatAttachments
        );
      } catch (saveErr) {
        console.error('Save streaming chat failed:', saveErr);
      }
    }

    streamFinished = true;
    if (!clientClosed && !res.writableEnded && res.headersSent) {
      res.end();
    }
  }
});

// Chat endpoint
router.post('/', authenticateToken, parseChatMultipart, async (req, res) => {
  try {
    const body = parseChatRequestBody(req);
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];
    const requestMessages = Array.isArray(body.messages)
      ? body.messages
        .filter(msg => msg && ['system', 'user', 'assistant'].includes(msg.role))
        .map(msg => ({ role: msg.role, content: String(msg.content || '') }))
      : [];

    if (requestMessages.length === 0 && uploadedFiles.length === 0) {
      return res.status(400).json({ error: '消息不能为空' });
    }

    let latestUserMessage = [...requestMessages]
      .reverse()
      .find(msg => msg?.role === 'user' && typeof msg.content === 'string' && msg.content.trim());
    if (!latestUserMessage && uploadedFiles.length > 0) {
      latestUserMessage = { role: 'user', content: DEFAULT_ATTACHMENT_PROMPT };
      requestMessages.push(latestUserMessage);
    }
    if (!latestUserMessage) {
      return res.status(400).json({ error: '用户消息不能为空' });
    }

    let existingSession = null;
    if (body.sessionId) {
      existingSession = getOwnedSession(body.sessionId, req.user.id);
      if (!existingSession) return res.status(404).json({ error: '会话不存在' });
    }

    const chatTeam = normalizeChatTeam(body.team || existingSession?.team || 'all');
    const chatAttachments = await processChatAttachments(uploadedFiles);
    const platformContext = await gatherContext(requestMessages, chatTeam);
    const previousAttachmentContext = getSessionAttachmentContext(existingSession?.id, req.user.id);
    const currentAttachmentContext = formatAttachmentContext('用户本轮上传附件内容', chatAttachments);
    const context = [platformContext, previousAttachmentContext, currentAttachmentContext].filter(Boolean).join('\n\n');
    const userName = db.prepare('SELECT display_name FROM users WHERE id = ?').get(req.user.id);

    const teamLabel = chatTeam === 'control' ? '控制组' : chatTeam === 'power' ? '动力组' : '公共（控制组+动力组）';

    const systemPrompt = `你是 Conter，天津大学 Chem-E-Car 实验数据平台的 AI 助手。
你同时服务两个组：
- **控制组**：负责小车的控制系统，包括传感器、单片机（Arduino/STM32）、控制算法、RS485 通信等
- **动力组**：负责小车的化学动力系统，包括化学电池、电化学测试等

当前模式：${teamLabel}
当前用户：${userName?.display_name || '未知'}
当前时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}

以下是平台的实时数据与附件上下文（平台数据已按当前模式过滤）：

${context}

回答要求：
- 使用简体中文回答
- 回答简洁准确
- 使用 Markdown 做清晰排版：标题、列表、加粗、表格、代码块按需使用；涉及对比、参数、清单时优先用表格
- 涉及流程图、框图、结构图时优先使用表格或对齐良好的等宽代码块；如果使用字符图，请保持列宽和箭头对齐
- 当前模式为"${teamLabel}"，你**只能基于上面提供的数据回答**，不要编造其他组的信息
- 如果用户询问某个文件，请仔细查看上下文中的【系统自动读取：文件 xxx 的具体内容】部分并据此回答
- 如果用户上传了附件，请优先依据【用户本轮上传附件内容】和【本会话已上传附件内容】回答；图片附件来自 OCR 文本，无法确认非文字细节时要明确说明
- 根据当前模式给予对应方向的技术指导（控制组→电路/编程/通信，动力组→化学/电池/反应，公共→综合两组）`;


    let apiMessages = [
      { role: 'system', content: systemPrompt },
      ...requestMessages.slice(-20) // 保留最近20条对话
    ];

    let finalReply = '';
    const tools = [
      {
        type: "function",
        function: {
          name: "read_file_content",
          description: "读取平台中已上传文件的具体文本内容。当用户询问某个文件的细节或要求分析某个文件时使用此工具。",
          parameters: {
            type: "object",
            properties: {
              file_name: {
                type: "string",
                description: "文件的原始名称（如 data.txt, report.pdf）。请严格匹配【文件管理】列表中提供的文件名。"
              }
            },
            required: ["file_name"]
          }
        }
      }
    ];

    // 最多循环3次以支持工具调用链
    const apiKey = requireDeepSeekApiKey();
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`${DEEPSEEK_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-v4-pro',
          messages: apiMessages,
          temperature: 0.7,
          max_tokens: 8192,
          stream: false,
          tools: tools
        })
      });

      if (!response.ok) {
        const errData = await response.text();
        console.error('DeepSeek API error:', response.status, errData);
        return res.status(502).json({ error: 'AI 服务暂时不可用，请稍后重试' });
      }

      const data = await response.json();
      const responseMessage = data.choices?.[0]?.message;

      if (!responseMessage) {
        finalReply = '抱歉，我暂时无法回答这个问题。';
        break;
      }

      if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
        apiMessages.push(responseMessage);

        for (const toolCall of responseMessage.tool_calls) {
          if (toolCall.function.name === 'read_file_content') {
            try {
              const args = JSON.parse(toolCall.function.arguments);
              console.log('AI is reading file:', args.file_name);
              const content = await readFileContent(args.file_name, { team: chatTeam });
              apiMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: content
              });
            } catch (e) {
              apiMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: "工具调用参数解析失败"
              });
            }
          }
        }
      } else {
        finalReply = responseMessage.content || '抱歉，未能生成有效的回答。';
        break;
      }
    }

    const reply = finalReply || '已处理请求，但未生成内容。';
    const finalSessionId = existingSession?.id || createChatSession(req.user.id, latestUserMessage.content, chatTeam);
    saveChatExchange(finalSessionId, req.user.id, latestUserMessage.content, reply, chatTeam, chatAttachments);

    res.json({
      reply,
      sessionId: finalSessionId,
      attachments: chatAttachments.map(toPublicAttachment)
    });
  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: '服务器错误: ' + err.message });
  }
});

module.exports = router;
