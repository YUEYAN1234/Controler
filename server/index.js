const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// 等数据库初始化完成后再挂载路由和启动服务
db.ready.then(() => {
  // API routes
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/folders', require('./routes/folders'));
  app.use('/api/files', require('./routes/files'));
  app.use('/api/comments', require('./routes/comments'));
  app.use('/api/announcements', require('./routes/announcements'));
  app.use('/api/reservations', require('./routes/reservations'));
  app.use('/api/messages', require('./routes/messages'));
  app.use('/api/games', require('./routes/games'));
  app.use('/api/chat', require('./routes/chat'));

  // Serve static frontend in production
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '..', 'dist')));
    app.use((req, res) => {
      res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
    });
  }

  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
});
