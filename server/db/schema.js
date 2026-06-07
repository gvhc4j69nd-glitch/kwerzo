'use strict';

const db = {
  pool: null,
  devMode: !process.env.DATABASE_URL
};

if (!db.devMode) {
  const { Pool } = require('pg');
  db.pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

const memDb = {
  users: [],
  leaderboard: []
};
let memNextId = 1;

// Run each DDL statement separately — node-postgres only executes the FIRST
// statement in a multi-statement string, so chaining via semicolons silently
// drops everything after the first one.
async function runDDL(sql, label) {
  try {
    await db.pool.query(sql);
  } catch (err) {
    // Log but don't abort — some ALTER TABLE statements are expected to be
    // no-ops (e.g. column already exists in older Postgres without IF NOT EXISTS)
    console.warn(`[schema] ${label}:`, err.message);
  }
}

async function initDb() {
  if (db.devMode) {
    console.log('[kwerzo] No DATABASE_URL — running with in-memory storage');
    return;
  }
  try {
    // ── Users ──────────────────────────────────────────────────────────────────
    await runDDL(`
      CREATE TABLE IF NOT EXISTS kwerzo_users (
        id            SERIAL PRIMARY KEY,
        username      VARCHAR(32)  UNIQUE NOT NULL,
        email         VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT         NOT NULL,
        created_at    TIMESTAMPTZ  DEFAULT NOW()
      )
    `, 'create kwerzo_users');

    // ── Leaderboard ────────────────────────────────────────────────────────────
    await runDDL(`
      CREATE TABLE IF NOT EXISTS kwerzo_leaderboard (
        user_id      INTEGER PRIMARY KEY REFERENCES kwerzo_users(id) ON DELETE CASCADE,
        wins         INTEGER DEFAULT 0,
        losses       INTEGER DEFAULT 0,
        games_played INTEGER DEFAULT 0,
        total_score  INTEGER DEFAULT 0,
        elo_rating   INTEGER DEFAULT 1000
      )
    `, 'create kwerzo_leaderboard');

    // Ensure columns exist on tables that may pre-date them
    await runDDL(`ALTER TABLE kwerzo_leaderboard ADD COLUMN IF NOT EXISTS elo_rating  INTEGER DEFAULT 1000`, 'add elo_rating');
    await runDDL(`ALTER TABLE kwerzo_leaderboard ADD COLUMN IF NOT EXISTS total_score INTEGER DEFAULT 0`,    'add total_score');

    // Backfill: ensure every existing user has a leaderboard row
    await runDDL(`
      INSERT INTO kwerzo_leaderboard (user_id)
      SELECT id FROM kwerzo_users
      ON CONFLICT (user_id) DO NOTHING
    `, 'backfill leaderboard rows');

    // ── Rooms ──────────────────────────────────────────────────────────────────
    await runDDL(`
      CREATE TABLE IF NOT EXISTS kwerzo_rooms (
        room_id          VARCHAR(16) PRIMARY KEY,
        host_id          TEXT        NOT NULL,
        status           VARCHAR(16) NOT NULL DEFAULT 'waiting',
        players          JSONB       NOT NULL DEFAULT '[]',
        game_state       JSONB,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `, 'create kwerzo_rooms');

    await runDDL(`CREATE INDEX IF NOT EXISTS idx_rooms_status   ON kwerzo_rooms(status)`,          'index rooms status');
    await runDDL(`CREATE INDEX IF NOT EXISTS idx_rooms_activity ON kwerzo_rooms(last_activity_at)`, 'index rooms activity');

    console.log('[kwerzo] DB initialized');
  } catch (err) {
    console.warn('[kwerzo] DB setup failed — falling back to in-memory storage:', err.message);
    db.devMode = true;
    db.pool = null;
  }
}

module.exports = { db, initDb, memDb, memNextId: () => memNextId++ };
