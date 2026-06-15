import React, { useState, useEffect, useRef, useCallback } from 'react';
import { submitGameScore, getLeaderboard, getMyBestScore } from '../api';
import { useAuth } from '../AuthContext';

const CELL = 16;
const COLS = 36;
const ROWS = 24;
const WIDTH = COLS * CELL;
const HEIGHT = ROWS * CELL;
const FOOD_FOR_POWER = 10;
const POWER_BREAK_GAIN = 5;
const CURRENT_GAME = 'snake_power';
const HISTORY_GAME = 'snake';

const DIR = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 },
};

function safeRoundRect(ctx, x, y, width, height, radius) {
  if (ctx.roundRect) {
    ctx.roundRect(x, y, width, height, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
}

function randomFood(snake, obstacles = []) {
  let pos;
  do {
    pos = {
      x: Math.floor(Math.random() * COLS),
      y: Math.floor(Math.random() * ROWS),
    };
  } while (
    snake.some(s => s.x === pos.x && s.y === pos.y) ||
    obstacles.some(o => o.x === pos.x && o.y === pos.y)
  );
  return pos;
}

function randomObstacle(snake, obstacles, food) {
  let pos;
  do {
    pos = {
      x: Math.floor(Math.random() * COLS),
      y: Math.floor(Math.random() * ROWS),
      spawnTime: Date.now()
    };
  } while (
    snake.some(s => s.x === pos.x && s.y === pos.y) ||
    obstacles.some(o => o.x === pos.x && o.y === pos.y) ||
    (food && food.x === pos.x && food.y === pos.y)
  );
  return pos;
}

function lerp(start, end, amount) {
  return start + (end - start) * amount;
}

function mixColor(from, to, amount) {
  return from.map((value, index) => Math.round(lerp(value, to[index], amount)));
}

function LeaderboardPanel({ title, emptyText, leaderboard, user }) {
  return (
    <div className="snake-leaderboard glass-panel">
      <h3 className="snake-lb-title">{title}</h3>
      {leaderboard.length === 0 ? (
        <div className="snake-lb-empty">{emptyText}</div>
      ) : (
        <div className="snake-lb-list">
          {leaderboard.map((entry, i) => (
            <div
              key={entry.user_id}
              className={`snake-lb-item ${entry.user_id === user?.id ? 'snake-lb-me' : ''}`}
            >
              <div className="snake-lb-rank">
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`}
              </div>
              <div className="snake-lb-name">{entry.display_name}</div>
              <div className="snake-lb-score">{entry.best_score}</div>
              <div className="snake-lb-plays">{entry.play_count}局</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SnakeGame() {
  const { user } = useAuth();
  const canvasRef = useRef(null);
  const gameLoop = useRef(null);
  const dirRef = useRef(DIR.RIGHT);
  const nextDirRef = useRef(DIR.RIGHT);
  const snakeRef = useRef([{ x: 5, y: 10 }, { x: 4, y: 10 }, { x: 3, y: 10 }]);
  const obstaclesRef = useRef([]);
  const foodRef = useRef(randomFood(snakeRef.current, obstaclesRef.current));
  const scoreRef = useRef(0);
  const foodCountRef = useRef(0);
  const powerChargesRef = useRef(0);
  const powerVisualRef = useRef(0);

  const [gameState, setGameState] = useState('idle'); // idle | playing | over
  const [score, setScore] = useState(0);
  const [beansEaten, setBeansEaten] = useState(0);
  const [powerCharges, setPowerCharges] = useState(0);
  const [bestScore, setBestScore] = useState(0);
  const [playCount, setPlayCount] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [historyLeaderboard, setHistoryLeaderboard] = useState([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistoryLeaderboard, setShowHistoryLeaderboard] = useState(false);
  const [speed, setSpeed] = useState(120);

  // 加载排行榜和个人最高分
  const loadData = useCallback(async () => {
    try {
      const [currentLb, my] = await Promise.all([
        getLeaderboard(CURRENT_GAME),
        getMyBestScore(CURRENT_GAME),
      ]);
      setLeaderboard(currentLb);
      setBestScore(my.best_score || 0);
      setPlayCount(my.play_count || 0);
    } catch (e) {
      console.error('加载排行榜失败:', e);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const loadHistoryData = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const lb = await getLeaderboard(HISTORY_GAME);
      setHistoryLeaderboard(lb);
      setHistoryLoaded(true);
    } catch (e) {
      console.error('加载历史榜单失败:', e);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const toggleHistoryLeaderboard = useCallback(() => {
    const nextVisible = !showHistoryLeaderboard;
    setShowHistoryLeaderboard(nextVisible);
    if (nextVisible && !historyLoaded && !historyLoading) {
      loadHistoryData();
    }
  }, [historyLoaded, historyLoading, loadHistoryData, showHistoryLeaderboard]);

  // 绘制
  const draw = useCallback(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    const now = Date.now();

    // 背景
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // 网格
    ctx.strokeStyle = 'rgba(255,255,255,0.03)';
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= WIDTH; x += CELL) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, HEIGHT); ctx.stroke();
    }
    for (let y = 0; y <= HEIGHT; y += CELL) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WIDTH, y); ctx.stroke();
    }

    // 蛇身
    const snake = snakeRef.current;
    const targetPower = powerChargesRef.current > 0 ? 1 : 0;
    const visualDelta = targetPower - powerVisualRef.current;
    powerVisualRef.current = Math.abs(visualDelta) < 0.01
      ? targetPower
      : powerVisualRef.current + visualDelta * 0.08;
    const powerLevel = powerVisualRef.current;
    const showPowerGlow = powerLevel > 0.01;
    snake.forEach((seg, i) => {
      const ratio = 1 - i / snake.length;
      const baseColor = [
        Math.round(68 + ratio * 40),
        Math.round(114 + ratio * 80),
        Math.round(196 + ratio * 40),
      ];
      const goldColor = [
        255,
        Math.round(186 + ratio * 48),
        Math.round(38 + ratio * 26),
      ];
      const [r, g, b] = mixColor(baseColor, goldColor, powerLevel);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.shadowColor = showPowerGlow
        ? `rgba(255, 214, 64, ${(i === 0 ? 0.6 : 0.24) * powerLevel})`
        : i === 0 ? 'rgba(100,160,255,0.6)' : 'transparent';
      ctx.shadowBlur = showPowerGlow ? (i === 0 ? lerp(10, 16, powerLevel) : 6 * powerLevel) : i === 0 ? 10 : 0;
      ctx.beginPath();
      safeRoundRect(ctx, seg.x * CELL + 1, seg.y * CELL + 1, CELL - 2, CELL - 2, 3);
      ctx.fill();
      if (showPowerGlow) {
        ctx.strokeStyle = `rgba(255, 245, 157, ${0.42 * powerLevel})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });
    ctx.shadowBlur = 0;

    // 障碍物
    const obstacles = obstaclesRef.current;
    obstacles.forEach(obs => {
      const age = now - (obs.spawnTime || 0);
      let scale = 1;
      let alpha = 1;
      
      if (age < 400) {
        const t = age / 400;
        scale = Math.sin(t * Math.PI / 2) + 0.2 * Math.sin(t * Math.PI * 2);
        alpha = t;
      }

      const cx = obs.x * CELL + CELL / 2;
      const cy = obs.y * CELL + CELL / 2;

      ctx.save();
      ctx.translate(cx, cy);
      if (scale !== 1) ctx.scale(scale, scale);
      ctx.globalAlpha = alpha;
      ctx.translate(-cx, -cy);

      // 外框
      ctx.fillStyle = '#2d3436';
      ctx.strokeStyle = '#d63031';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = 'rgba(214, 48, 49, 0.6)';
      ctx.shadowBlur = 8;
      
      ctx.beginPath();
      safeRoundRect(ctx, obs.x * CELL + 2, obs.y * CELL + 2, CELL - 4, CELL - 4, 3);
      ctx.fill();
      ctx.stroke();
      ctx.shadowBlur = 0;

      // 内部警告纹理
      ctx.beginPath();
      ctx.moveTo(obs.x * CELL + CELL/2 - 4, obs.y * CELL + CELL/2 - 4);
      ctx.lineTo(obs.x * CELL + CELL/2 + 4, obs.y * CELL + CELL/2 + 4);
      ctx.moveTo(obs.x * CELL + CELL/2 + 4, obs.y * CELL + CELL/2 - 4);
      ctx.lineTo(obs.x * CELL + CELL/2 - 4, obs.y * CELL + CELL/2 + 4);
      ctx.strokeStyle = '#ff7675';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.restore();
    });

    // 食物
    const food = foodRef.current;
    const foodX = food.x * CELL + CELL / 2;
    const foodY = food.y * CELL + CELL / 2;
    const foodGradient = ctx.createRadialGradient(foodX - 3, foodY - 3, 2, foodX, foodY, CELL / 2);
    foodGradient.addColorStop(0, '#fff8b5');
    foodGradient.addColorStop(0.45, '#ffd54f');
    foodGradient.addColorStop(1, '#f59e0b');
    ctx.fillStyle = foodGradient;
    ctx.shadowColor = 'rgba(255, 213, 79, 0.85)';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(foodX, foodY, CELL / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // 分数 HUD
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '13px "Inter", sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`得分: ${scoreRef.current}`, 10, 18);
    if (powerChargesRef.current > 0) {
      ctx.fillStyle = '#ffd54f';
      ctx.fillText(`破障: ${powerChargesRef.current}`, 10, 36);
    }
  }, []);

  const endGame = useCallback(async () => {
    clearInterval(gameLoop.current);
    powerChargesRef.current = 0;
    powerVisualRef.current = 0;
    setPowerCharges(0);
    setGameState('over');
    const finalScore = scoreRef.current;
    if (finalScore > 0) {
      try {
        await submitGameScore(CURRENT_GAME, finalScore);
      } catch (e) {
        console.error('提交分数失败:', e);
      }
    }
    loadData();
  }, [loadData]);

  // 游戏逻辑
  const tick = useCallback(() => {
    dirRef.current = nextDirRef.current;
    const snake = [...snakeRef.current];
    const head = { x: snake[0].x + dirRef.current.x, y: snake[0].y + dirRef.current.y };

    // 碰墙
    if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
      endGame();
      return;
    }
    // 碰自己
    if (snake.some(s => s.x === head.x && s.y === head.y)) {
      endGame();
      return;
    }
    // 碰障碍物
    const obstacleIndex = obstaclesRef.current.findIndex(o => o.x === head.x && o.y === head.y);
    if (obstacleIndex !== -1) {
      if (powerChargesRef.current > 0) {
        obstaclesRef.current = obstaclesRef.current.filter((_, index) => index !== obstacleIndex);
        const nextCharges = powerChargesRef.current - 1;
        powerChargesRef.current = nextCharges;
        setPowerCharges(nextCharges);
      } else {
        endGame();
        return;
      }
    }

    snake.unshift(head);

    // 吃食物
    if (head.x === foodRef.current.x && head.y === foodRef.current.y) {
      scoreRef.current += 10;
      foodCountRef.current += 1;
      setScore(scoreRef.current);
      setBeansEaten(foodCountRef.current);
      if (foodCountRef.current % FOOD_FOR_POWER === 0) {
        const nextCharges = powerChargesRef.current + POWER_BREAK_GAIN;
        powerChargesRef.current = nextCharges;
        setPowerCharges(nextCharges);
      }
      // 生成新障碍物
      const newObs = randomObstacle(snake, obstaclesRef.current, foodRef.current);
      obstaclesRef.current.push(newObs);
      // 生成新食物
      foodRef.current = randomFood(snake, obstaclesRef.current);
      // 加速（有下限）
      setSpeed(prev => Math.max(50, prev - 2));
    } else {
      snake.pop();
    }

    snakeRef.current = snake;
  }, [endGame]);

  // 启动游戏
  const startGame = useCallback(() => {
    snakeRef.current = [{ x: 5, y: 10 }, { x: 4, y: 10 }, { x: 3, y: 10 }];
    obstaclesRef.current = [];
    foodRef.current = randomFood(snakeRef.current, obstaclesRef.current);
    dirRef.current = DIR.RIGHT;
    nextDirRef.current = DIR.RIGHT;
    scoreRef.current = 0;
    foodCountRef.current = 0;
    powerChargesRef.current = 0;
    powerVisualRef.current = 0;
    setScore(0);
    setBeansEaten(0);
    setPowerCharges(0);
    setSpeed(120);
    setGameState('playing');
    draw();
  }, [draw]);

  // 游戏逻辑循环
  useEffect(() => {
    if (gameState !== 'playing') return;
    gameLoop.current = setInterval(tick, speed);
    return () => clearInterval(gameLoop.current);
  }, [gameState, speed, tick]);

  // 渲染循环（60FPS）
  useEffect(() => {
    let animId;
    const render = () => {
      draw();
      animId = requestAnimationFrame(render);
    };
    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [draw]);

  // 键盘控制
  useEffect(() => {
    const handler = (e) => {
      if (gameState !== 'playing') {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          startGame();
        }
        return;
      }
      const cur = dirRef.current;
      switch (e.key) {
        case 'ArrowUp': case 'w': case 'W':
          if (cur !== DIR.DOWN) nextDirRef.current = DIR.UP;
          e.preventDefault();
          break;
        case 'ArrowDown': case 's': case 'S':
          if (cur !== DIR.UP) nextDirRef.current = DIR.DOWN;
          e.preventDefault();
          break;
        case 'ArrowLeft': case 'a': case 'A':
          if (cur !== DIR.RIGHT) nextDirRef.current = DIR.LEFT;
          e.preventDefault();
          break;
        case 'ArrowRight': case 'd': case 'D':
          if (cur !== DIR.LEFT) nextDirRef.current = DIR.RIGHT;
          e.preventDefault();
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [gameState, startGame]);

  // 初始绘制（由 requestAnimationFrame 自动处理）
  const powerProgress = beansEaten % FOOD_FOR_POWER;

  return (
    <div>
      <h2 className="page-title">🎮 小游戏</h2>
      <div className="snake-layout">
        {/* 左侧：游戏区域 */}
        <div className="snake-game-panel">
          <div className="snake-header">
            <div className="snake-stat">
              <span className="snake-stat-label">当前得分</span>
              <span className="snake-stat-value">{score}</span>
            </div>
            <div className="snake-stat">
              <span className="snake-stat-label">历史最高</span>
              <span className="snake-stat-value snake-stat-best">{bestScore}</span>
            </div>
            <div className="snake-stat">
              <span className="snake-stat-label">游玩次数</span>
              <span className="snake-stat-value">{playCount}</span>
            </div>
            <div className={`snake-stat ${powerCharges > 0 ? 'snake-stat-power' : ''}`}>
              <span className="snake-stat-label">超能力</span>
              <span className="snake-stat-value">
                {powerCharges > 0 ? `x${powerCharges}` : `${powerProgress}/${FOOD_FOR_POWER}`}
              </span>
            </div>
          </div>

          <div className="snake-canvas-wrap">
            <canvas
              ref={canvasRef}
              width={WIDTH}
              height={HEIGHT}
              className="snake-canvas"
            />
            {gameState !== 'playing' && (
              <div className="snake-overlay">
                {gameState === 'over' && (
                  <div className="snake-over-score">
                    得分：{score}
                  </div>
                )}
                <button className="btn btn-primary snake-start-btn" onClick={startGame}>
                  {gameState === 'idle' ? '开始游戏' : '再来一局'}
                </button>
                <div className="snake-hint">
                  方向键 / WASD 控制方向
                </div>
              </div>
            )}
          </div>

          {/* 移动端触屏控制 */}
          <div className="snake-touch-controls">
            <div></div>
            <button className="snake-touch-btn" onTouchStart={(e) => { e.preventDefault(); if (dirRef.current !== DIR.DOWN) nextDirRef.current = DIR.UP; }}>▲</button>
            <div></div>
            <button className="snake-touch-btn" onTouchStart={(e) => { e.preventDefault(); if (dirRef.current !== DIR.RIGHT) nextDirRef.current = DIR.LEFT; }}>◀</button>
            <div></div>
            <button className="snake-touch-btn" onTouchStart={(e) => { e.preventDefault(); if (dirRef.current !== DIR.LEFT) nextDirRef.current = DIR.RIGHT; }}>▶</button>
            <div></div>
            <button className="snake-touch-btn" onTouchStart={(e) => { e.preventDefault(); if (dirRef.current !== DIR.UP) nextDirRef.current = DIR.DOWN; }}>▼</button>
            <div></div>
          </div>
        </div>

        {/* 右侧：排行榜 */}
        <div className="snake-leaderboards">
          <LeaderboardPanel
            title="🏆 排行榜"
            emptyText="暂无记录，快来抢占榜首！"
            leaderboard={leaderboard}
            user={user}
          />
          <button
            type="button"
            className="btn btn-ghost snake-history-toggle"
            onClick={toggleHistoryLeaderboard}
            disabled={historyLoading}
          >
            {historyLoading ? '加载历史榜单...' : showHistoryLeaderboard ? '隐藏历史榜单' : '查看历史榜单'}
          </button>
          {showHistoryLeaderboard && (
            <LeaderboardPanel
              title="📜 历史榜单"
              emptyText={historyLoading ? '历史榜单加载中...' : '暂无历史记录'}
              leaderboard={historyLeaderboard}
              user={user}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default SnakeGame;
