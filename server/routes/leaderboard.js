'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const { db, memDb } = require('../db/schema');   // memDb imported once at top

const router  = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'kwerzo-dev-secret';

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

router.get('/', authMiddleware, async (req, res) => {
  // ── Dev / in-memory mode ─────────────────────────────────────────────────
  if (db.devMode) {
    const top = memDb.users.map((u, i) => ({
      username:     u.username,
      wins:         0,
      losses:       0,
      games_played: 0,
      total_score:  0,
      elo_rating:   1000,
      rank:         i + 1,
    }));
    const me = top.find(r => r.username === req.user.username) || null;
    return res.json({ top, me });
  }

  // ── PostgreSQL mode ──────────────────────────────────────────────────────
  try {
    const { rows: top } = await db.pool.query(`
      SELECT
        u.username,
        COALESCE(l.wins,         0) AS wins,
        COALESCE(l.losses,       0) AS losses,
        COALESCE(l.games_played, 0) AS games_played,
        COALESCE(l.total_score,  0) AS total_score,
        COALESCE(l.elo_rating, 1000) AS elo_rating,
        ROW_NUMBER() OVER (
          ORDER BY COALESCE(l.elo_rating,1000) DESC,
                   COALESCE(l.wins,0)         DESC,
                   COALESCE(l.total_score,0)  DESC
        ) AS rank
      FROM kwerzo_users u
      LEFT JOIN kwerzo_leaderboard l ON l.user_id = u.id
      ORDER BY elo_rating DESC, wins DESC, total_score DESC
      LIMIT 100
    `);

    // Current user's row (use LEFT JOIN so they always appear, even with 0 stats)
    const { rows: myRows } = await db.pool.query(`
      SELECT
        COALESCE(l.wins,         0)    AS wins,
        COALESCE(l.losses,       0)    AS losses,
        COALESCE(l.games_played, 0)    AS games_played,
        COALESCE(l.total_score,  0)    AS total_score,
        COALESCE(l.elo_rating, 1000)   AS elo_rating,
        (
          SELECT COUNT(*) + 1
          FROM kwerzo_leaderboard l2
          WHERE COALESCE(l2.elo_rating,1000) > COALESCE(l.elo_rating,1000)
             OR (COALESCE(l2.elo_rating,1000) = COALESCE(l.elo_rating,1000)
                 AND COALESCE(l2.wins,0) > COALESCE(l.wins,0))
        ) AS rank
      FROM kwerzo_users u
      LEFT JOIN kwerzo_leaderboard l ON l.user_id = u.id
      WHERE u.id = $1
    `, [req.user.userId]);

    res.json({ top, me: myRows[0] || null });
  } catch (err) {
    console.error('[leaderboard] GET error:', err.message);
    res.status(500).json({ error: 'Server error', detail: err.message });
  }
});

// ── Update stats after a completed game ─────────────────────────────────────
async function updateStats(winnerIds, allPlayerIds, scores) {
  if (db.devMode) return;
  if (!allPlayerIds || allPlayerIds.length === 0) return;

  for (const userId of allPlayerIds) {
    const isWinner  = winnerIds.includes(userId);
    const score     = scores[userId] ?? 0;
    const eloDelta  = isWinner ? 15 : -10;

    try {
      await db.pool.query(`
        INSERT INTO kwerzo_leaderboard
          (user_id, wins, losses, games_played, total_score, elo_rating)
        VALUES ($1, $2, $3, 1, $4, 1000)
        ON CONFLICT (user_id) DO UPDATE SET
          wins         = kwerzo_leaderboard.wins         + $2,
          losses       = kwerzo_leaderboard.losses       + $3,
          games_played = kwerzo_leaderboard.games_played + 1,
          total_score  = kwerzo_leaderboard.total_score  + $4,
          elo_rating   = GREATEST(800,
                           kwerzo_leaderboard.elo_rating + $5)
      `, [userId, isWinner ? 1 : 0, isWinner ? 0 : 1, score, eloDelta]);
    } catch (err) {
      console.error(`[leaderboard] updateStats userId=${userId}:`, err.message);
    }
  }
}

module.exports = { router, updateStats };
