'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const { db } = require('../db/schema');

const router = express.Router();
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
  if (db.devMode) {
    // Dev mode: return in-memory users with zeroed stats so the table isn't blank
    const { memDb } = require('../db/schema');
    const top = memDb.users.map((u, i) => ({
      username: u.username, wins: 0, losses: 0,
      games_played: 0, total_score: 0, elo_rating: 1000, rank: i + 1
    }));
    const me = top.find(r => r.username === req.user.username) || null;
    return res.json({ top, me });
  }
  try {
    // All users who have a leaderboard row, ordered by elo then score
    const result = await db.pool.query(`
      SELECT
        u.username,
        l.wins,
        l.losses,
        l.games_played,
        l.total_score,
        l.elo_rating,
        ROW_NUMBER() OVER (ORDER BY l.elo_rating DESC, l.wins DESC, l.total_score DESC) AS rank
      FROM kwerzo_leaderboard l
      JOIN kwerzo_users u ON u.id = l.user_id
      ORDER BY l.elo_rating DESC, l.wins DESC, l.total_score DESC
      LIMIT 100
    `);

    // Current user's own row
    const myResult = await db.pool.query(`
      SELECT
        l.wins,
        l.losses,
        l.games_played,
        l.total_score,
        l.elo_rating,
        (
          SELECT COUNT(*) + 1
          FROM kwerzo_leaderboard l2
          WHERE l2.elo_rating > l.elo_rating
            OR (l2.elo_rating = l.elo_rating AND l2.wins > l.wins)
        ) AS rank
      FROM kwerzo_leaderboard l
      WHERE l.user_id = $1
    `, [req.user.userId]);

    res.json({ top: result.rows, me: myResult.rows[0] || null });
  } catch (err) {
    console.error('[leaderboard] GET error:', err.message);
    res.status(500).json({ error: 'Server error', detail: err.message });
  }
});

async function updateStats(winnerIds, allPlayerIds, scores) {
  if (db.devMode) return;
  if (!allPlayerIds || allPlayerIds.length === 0) return;

  for (const userId of allPlayerIds) {
    const isWinner = winnerIds.includes(userId);
    const score    = scores[userId] ?? 0;

    try {
      // Ensure leaderboard row exists, then update it
      await db.pool.query(`
        INSERT INTO kwerzo_leaderboard (user_id, wins, losses, games_played, total_score, elo_rating)
        VALUES ($1, $2, $3, 1, $4, 1000)
        ON CONFLICT (user_id) DO UPDATE SET
          wins         = kwerzo_leaderboard.wins         + $2,
          losses       = kwerzo_leaderboard.losses       + $3,
          games_played = kwerzo_leaderboard.games_played + 1,
          total_score  = kwerzo_leaderboard.total_score  + $4,
          elo_rating   = kwerzo_leaderboard.elo_rating   + $5
      `, [
        userId,
        isWinner ? 1 : 0,
        isWinner ? 0 : 1,
        score,
        isWinner ? 15 : -10,   // simple Elo-style delta
      ]);
    } catch (err) {
      console.error(`[leaderboard] updateStats failed for userId ${userId}:`, err.message);
    }
  }
}

module.exports = { router, updateStats };
