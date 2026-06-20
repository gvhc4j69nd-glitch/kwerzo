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
      user_id:      u.id,
      username:     u.username,
      wins:         0,
      losses:       0,
      games_played: 0,
      total_score:  0,
      elo_rating:   1000,
      rank:         i + 1,
    }));
    const topBots = memDb.users.map((u, i) => ({
      user_id:          u.id,
      username:         u.username,
      bot_wins:         0,
      bot_losses:       0,
      bot_games_played: 0,
      bot_total_score:  0,
      bot_rating:       1000,
      rank:             i + 1,
    }));
    const me     = top.find(r => r.username === req.user.username) || null;
    const meBots = topBots.find(r => r.username === req.user.username) || null;
    return res.json({ top, me, topBots, meBots });
  }

  // ── PostgreSQL mode ──────────────────────────────────────────────────────
  try {
    // Human-only ELO leaderboard
    const { rows: top } = await db.pool.query(`
      SELECT
        u.id AS user_id,
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

    // Current user's row on the human ELO leaderboard
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

    // "Vs Bots" leaderboard — rating weighted by bot difficulty
    const { rows: topBots } = await db.pool.query(`
      SELECT
        u.id AS user_id,
        u.username,
        COALESCE(l.bot_wins,         0) AS bot_wins,
        COALESCE(l.bot_losses,       0) AS bot_losses,
        COALESCE(l.bot_games_played, 0) AS bot_games_played,
        COALESCE(l.bot_total_score,  0) AS bot_total_score,
        COALESCE(l.bot_rating, 1000) AS bot_rating,
        ROW_NUMBER() OVER (
          ORDER BY COALESCE(l.bot_rating,1000) DESC,
                   COALESCE(l.bot_wins,0)      DESC,
                   COALESCE(l.bot_total_score,0) DESC
        ) AS rank
      FROM kwerzo_users u
      LEFT JOIN kwerzo_leaderboard l ON l.user_id = u.id
      ORDER BY bot_rating DESC, bot_wins DESC, bot_total_score DESC
      LIMIT 100
    `);

    // Current user's row on the "vs bots" leaderboard
    const { rows: myBotRows } = await db.pool.query(`
      SELECT
        COALESCE(l.bot_wins,         0)  AS bot_wins,
        COALESCE(l.bot_losses,       0)  AS bot_losses,
        COALESCE(l.bot_games_played, 0)  AS bot_games_played,
        COALESCE(l.bot_total_score,  0)  AS bot_total_score,
        COALESCE(l.bot_rating, 1000)     AS bot_rating,
        (
          SELECT COUNT(*) + 1
          FROM kwerzo_leaderboard l2
          WHERE COALESCE(l2.bot_rating,1000) > COALESCE(l.bot_rating,1000)
             OR (COALESCE(l2.bot_rating,1000) = COALESCE(l.bot_rating,1000)
                 AND COALESCE(l2.bot_wins,0) > COALESCE(l.bot_wins,0))
        ) AS rank
      FROM kwerzo_users u
      LEFT JOIN kwerzo_leaderboard l ON l.user_id = u.id
      WHERE u.id = $1
    `, [req.user.userId]);

    res.json({
      top, me: myRows[0] || null,
      topBots, meBots: myBotRows[0] || null,
    });
  } catch (err) {
    console.error('[leaderboard] GET error:', err.message);
    res.status(500).json({ error: 'Server error', detail: err.message });
  }
});

// Rating swing multipliers by bot difficulty — tougher bots move the
// "vs bots" rating more in both directions (bigger risk/reward).
const BOT_DIFFICULTY_WEIGHT = { easy: 0.5, medium: 1, hard: 1.75, expert: 2.5 };

// ── Update stats after a completed game ─────────────────────────────────────
// opts: { vsBots: boolean, botWeight: number }
//   - vsBots=true  → update the weighted "vs bots" rating (bot_rating)
//   - vsBots=false → update the human-only ELO rating (elo_rating)
async function updateStats(winnerIds, allPlayerIds, scores, opts = {}) {
  if (db.devMode) return;
  if (!allPlayerIds || allPlayerIds.length === 0) return;

  const { vsBots = false, botWeight = 1 } = opts;

  for (const userId of allPlayerIds) {
    const isWinner = winnerIds.includes(userId);
    const score    = scores[userId] ?? 0;

    try {
      if (vsBots) {
        const delta = Math.round((isWinner ? 15 : -10) * botWeight);
        await db.pool.query(`
          INSERT INTO kwerzo_leaderboard
            (user_id, bot_wins, bot_losses, bot_games_played, bot_total_score, bot_rating)
          VALUES ($1, $2, $3, 1, $4, GREATEST(800, 1000 + $5))
          ON CONFLICT (user_id) DO UPDATE SET
            bot_wins         = kwerzo_leaderboard.bot_wins         + $2,
            bot_losses       = kwerzo_leaderboard.bot_losses       + $3,
            bot_games_played = kwerzo_leaderboard.bot_games_played + 1,
            bot_total_score  = kwerzo_leaderboard.bot_total_score  + $4,
            bot_rating       = GREATEST(800,
                                 COALESCE(kwerzo_leaderboard.bot_rating, 1000) + $5)
        `, [userId, isWinner ? 1 : 0, isWinner ? 0 : 1, score, delta]);
      } else {
        const eloDelta = isWinner ? 15 : -10;
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
      }
    } catch (err) {
      console.error(`[leaderboard] updateStats userId=${userId}:`, err.message);
    }
  }
}

module.exports = { router, updateStats, BOT_DIFFICULTY_WEIGHT };
