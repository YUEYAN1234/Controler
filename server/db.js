const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'data.db');

// sql.js 初始化是异步的，但路由文件需要同步的 db 对象。
// 我们用一个 proxy + 延迟初始化的方式来解决这个问题。
// server/index.js 需要 await db.ready 后再启动服务器。

let _db = null;
let _readyResolve;
const _readyPromise = new Promise((resolve) => { _readyResolve = resolve; });
let _inTransaction = false;

// 自动持久化：每次写操作后保存到磁盘
function saveToFile() {
  if (!_db) return;
  const data = _db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// 包装 sql.js 的 Statement，使其兼容 better-sqlite3 的 API
// better-sqlite3: db.prepare(sql).run(...params) / .get(...params) / .all(...params)
function createStatement(sql) {
  return {
    run(...params) {
      _db.run(sql, params);
      // 模拟 better-sqlite3 的返回值
      const lastId = _db.exec('SELECT last_insert_rowid() as id')[0]?.values[0][0];
      const changes = _db.getRowsModified();
      if (!_inTransaction) saveToFile();
      return { lastInsertRowid: lastId, changes };
    },
    get(...params) {
      const stmt = _db.prepare(sql);
      stmt.bind(params);
      if (stmt.step()) {
        const columns = stmt.getColumnNames();
        const values = stmt.get();
        stmt.free();
        const row = {};
        columns.forEach((col, i) => { row[col] = values[i]; });
        return row;
      }
      stmt.free();
      return undefined;
    },
    all(...params) {
      const stmt = _db.prepare(sql);
      stmt.bind(params);
      const columns = stmt.getColumnNames();
      const rows = [];
      while (stmt.step()) {
        const values = stmt.get();
        const row = {};
        columns.forEach((col, i) => { row[col] = values[i]; });
        rows.push(row);
      }
      stmt.free();
      return rows;
    }
  };
}

// 兼容 better-sqlite3 API 的包装对象
const dbWrapper = {
  ready: _readyPromise,

  prepare(sql) {
    return createStatement(sql);
  },

  exec(sql) {
    _db.run(sql);
    saveToFile();
  },

  pragma(pragmaStr) {
    try {
      _db.run(`PRAGMA ${pragmaStr}`);
    } catch (e) {
      // 部分 pragma 在 sql.js 中不支持（如 WAL 模式），静默忽略
    }
  },

  transaction(fn) {
    return (...args) => {
      _inTransaction = true;
      _db.run('BEGIN TRANSACTION');
      try {
        const result = fn(...args);
        _db.run('COMMIT');
        _inTransaction = false;
        saveToFile();
        return result;
      } catch (e) {
        _inTransaction = false;
        try { _db.run('ROLLBACK'); } catch (_) { /* already rolled back */ }
        throw e;
      }
    };
  }
};

// 异步初始化
(async () => {
  const SQL = await initSqlJs();

  // 如果数据库文件已存在，读取它
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    _db = new SQL.Database(fileBuffer);
  } else {
    _db = new SQL.Database();
  }

  // Enable foreign keys
  dbWrapper.pragma('foreign_keys = ON');

  // Initialize tables
  _db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES folders(id) ON DELETE CASCADE,
      created_by INTEGER REFERENCES users(id),
      team TEXT DEFAULT 'control',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      size INTEGER,
      mime_type TEXT,
      folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
      uploaded_by INTEGER REFERENCES users(id),
      team TEXT DEFAULT 'control',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id),
      pinned INTEGER DEFAULT 0,
      attachment_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS message_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id),
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS game_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      game TEXT NOT NULL DEFAULT 'snake',
      score INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lab_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      experimenter TEXT NOT NULL,
      purpose TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      team TEXT DEFAULT 'all',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      attachments_json TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migration for existing tables
  try {
    _db.run('ALTER TABLE announcements ADD COLUMN attachment_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL;');
  } catch (e) {
    // column already exists
  }

  // Migration: lab_reservations table
  try {
    _db.run(`CREATE TABLE IF NOT EXISTS lab_reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      experimenter TEXT NOT NULL,
      purpose TEXT DEFAULT '',
      conclusion TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`);
  } catch (e) {
    // table already exists
  }

  // Migration: add conclusion column
  try {
    _db.run('ALTER TABLE lab_reservations ADD COLUMN conclusion TEXT DEFAULT "";');
  } catch (e) {
    // column already exists
  }

  // Migration: add team column to folders, files, lab_reservations
  try { _db.run('ALTER TABLE folders ADD COLUMN team TEXT DEFAULT "control";'); } catch (e) { /* exists */ }
  try { _db.run('ALTER TABLE files ADD COLUMN team TEXT DEFAULT "control";'); } catch (e) { /* exists */ }
  try { _db.run('ALTER TABLE lab_reservations ADD COLUMN team TEXT DEFAULT "control";'); } catch (e) { /* exists */ }

  // Migration: add sort_order column to files
  try { _db.run('ALTER TABLE files ADD COLUMN sort_order INTEGER DEFAULT 0;'); } catch (e) { /* exists */ }

  // Migration: chat history tables
  try {
    _db.run(`CREATE TABLE IF NOT EXISTS chat_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      team TEXT DEFAULT 'all',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`);
  } catch (e) { /* exists */ }

  try {
    _db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      attachments_json TEXT DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`);
  } catch (e) { /* exists */ }

  try { _db.run("ALTER TABLE chat_messages ADD COLUMN attachments_json TEXT DEFAULT '[]';"); } catch (e) { /* exists */ }
  try { _db.run('CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated ON chat_sessions(user_id, updated_at);'); } catch (e) { /* ignore */ }
  try { _db.run('CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created ON chat_messages(session_id, created_at);'); } catch (e) { /* ignore */ }

  saveToFile();

  // Create default admin if not exists
  const adminExists = dbWrapper.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    const adminPassword = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV === 'production' ? null : 'admin123');
    if (!adminPassword) {
      throw new Error('ADMIN_PASSWORD must be set before first production initialization');
    }
    const hash = bcrypt.hashSync(adminPassword, 10);
    dbWrapper.prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)').run('admin', hash, '管理员', 'admin');
    console.log('✅ 默认管理员账号已创建 (用户名: admin)，请尽快修改密码');
  }

  _readyResolve();
  console.log('✅ 数据库初始化完成 (sql.js)');
})();

module.exports = dbWrapper;
