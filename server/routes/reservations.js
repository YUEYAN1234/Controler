const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../middleware/auth');

// 获取某月的所有预约
router.get('/', authenticateToken, (req, res) => {
  try {
    const { month, team } = req.query; // format: YYYY-MM
    const t = team || 'control';
    let rows;
    if (month) {
      rows = db.prepare(`
        SELECT r.*, u.display_name as booker_name 
        FROM lab_reservations r 
        LEFT JOIN users u ON r.user_id = u.id 
        WHERE r.date LIKE ? AND r.team = ?
        ORDER BY r.date, r.start_time
      `).all(month + '%', t);
    } else {
      rows = db.prepare(`
        SELECT r.*, u.display_name as booker_name 
        FROM lab_reservations r 
        LEFT JOIN users u ON r.user_id = u.id 
        WHERE r.team = ?
        ORDER BY r.date DESC, r.start_time
      `).all(t);
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 创建预约
router.post('/', authenticateToken, (req, res) => {
  try {
    const { date, startTime, endTime, experimenter, purpose, team } = req.body;
    const t = team || 'control';

    if (!date || !startTime || !endTime || !experimenter) {
      return res.status(400).json({ error: '日期、时间和实验人员为必填项' });
    }

    // 检查时间冲突：同一天同一组，时间段有重叠
    const conflicts = db.prepare(`
      SELECT * FROM lab_reservations 
      WHERE date = ? AND team = ? AND (
        (start_time < ? AND end_time > ?) OR
        (start_time < ? AND end_time > ?) OR
        (start_time >= ? AND end_time <= ?)
      )
    `).all(date, t, endTime, startTime, endTime, startTime, startTime, endTime);

    if (conflicts.length > 0) {
      return res.status(409).json({ error: '该时间段已被预约，请选择其他时间' });
    }

    const result = db.prepare(
      'INSERT INTO lab_reservations (user_id, date, start_time, end_time, experimenter, purpose, team) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.user.id, date, startTime, endTime, experimenter, purpose || '', t);

    res.json({ id: result.lastInsertRowid, message: '预约成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 更新预约（补写实验目的等）
router.put('/:id', authenticateToken, (req, res) => {
  try {
    const reservation = db.prepare('SELECT * FROM lab_reservations WHERE id = ?').get(req.params.id);
    if (!reservation) {
      return res.status(404).json({ error: '预约不存在' });
    }

    // 只有预约人或管理员可以修改
    if (reservation.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: '无权修改此预约' });
    }

    const { purpose, experimenter, startTime, endTime, conclusion } = req.body;
    if (purpose !== undefined) {
      db.prepare('UPDATE lab_reservations SET purpose = ? WHERE id = ?').run(purpose, req.params.id);
    }
    if (experimenter !== undefined) {
      db.prepare('UPDATE lab_reservations SET experimenter = ? WHERE id = ?').run(experimenter, req.params.id);
    }
    if (conclusion !== undefined) {
      db.prepare('UPDATE lab_reservations SET conclusion = ? WHERE id = ?').run(conclusion, req.params.id);
    }
    if (startTime && endTime) {
      // 检查时间冲突（排除自身）
      const conflicts = db.prepare(`
        SELECT * FROM lab_reservations 
        WHERE date = ? AND id != ? AND team = ? AND (
          (start_time < ? AND end_time > ?) OR
          (start_time < ? AND end_time > ?) OR
          (start_time >= ? AND end_time <= ?)
        )
      `).all(reservation.date, reservation.id, reservation.team || 'control', endTime, startTime, endTime, startTime, startTime, endTime);

      if (conflicts.length > 0) {
        return res.status(409).json({ error: '修改后的时间段与其他预约冲突' });
      }
      db.prepare('UPDATE lab_reservations SET start_time = ?, end_time = ? WHERE id = ?').run(startTime, endTime, req.params.id);
    }

    res.json({ message: '更新成功' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除预约
router.delete('/:id', authenticateToken, (req, res) => {
  try {
    const reservation = db.prepare('SELECT * FROM lab_reservations WHERE id = ?').get(req.params.id);
    if (!reservation) {
      return res.status(404).json({ error: '预约不存在' });
    }

    // 只有预约人或管理员可以删除
    if (reservation.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: '无权删除此预约' });
    }

    db.prepare('DELETE FROM lab_reservations WHERE id = ?').run(req.params.id);
    res.json({ message: '已取消预约' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
