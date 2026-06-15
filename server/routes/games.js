const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

// 提交分数
router.post('/scores', authenticateToken, (req, res) => {
  const { game, score } = req.body;
  if (!game || typeof score !== 'number' || score < 0) {
    return res.status(400).json({ error: '参数错误' });
  }
  const result = db.prepare(
    'INSERT INTO game_scores (user_id, game, score) VALUES (?, ?, ?)'
  ).run(req.user.id, game, score);
  res.json({ id: result.lastInsertRowid, score });
});

// 获取排行榜 — 每个用户只取最高分
router.get('/leaderboard/:game', authenticateToken, (req, res) => {
  const { game } = req.params;
  const rows = db.prepare(`
    SELECT gs.user_id, u.display_name, MAX(gs.score) as best_score, COUNT(gs.id) as play_count
    FROM game_scores gs
    JOIN users u ON u.id = gs.user_id
    WHERE gs.game = ?
    GROUP BY gs.user_id
    ORDER BY best_score DESC
    LIMIT 50
  `).all(game);
  res.json(rows);
});

// 获取当前用户的个人最高分
router.get('/my-best/:game', authenticateToken, (req, res) => {
  const { game } = req.params;
  const row = db.prepare(`
    SELECT MAX(score) as best_score, COUNT(id) as play_count
    FROM game_scores
    WHERE user_id = ? AND game = ?
  `).get(req.user.id, game);
  res.json(row || { best_score: 0, play_count: 0 });
});

module.exports = router;
