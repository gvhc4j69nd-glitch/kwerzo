'use strict';

const db = {
  pool:    null,
  devMode: !process.env.DATABASE_URL,
};

if (!db.devMode) {
  const { Pool } = require('pg');
  db.pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
  });
}

const memDb   = { users: [], leaderboard: [] };
let memNextId = 1;

// Run one DDL statement; throw on error so the caller knows what failed
async function runDDL(sql, label) {
  try {
    await db.pool.query(sql);
    console.log(`[schema] ✓ ${label}`);
  } catch (err) {
    // "column already exists" and "table already exists" are expected no-ops
    if (err.code === '42701' || err.code === '42P07') {
      console.log(`[schema] ~ ${label} (already exists)`);
    } else {
      console.error(`[schema] ✗ ${label}: ${err.message}`);
      throw err;   // re-throw so initDb can detect real failures
    }
  }
}

async function initDb() {
  if (db.devMode) {
    console.log('[kwerzo] No DATABASE_URL — running with in-memory storage');
    return;
  }

  // ── Verify connectivity before touching schema ────────────────────────────
  try {
    await db.pool.query('SELECT 1');
    console.log('[kwerzo] DB connection OK');
  } catch (err) {
    console.error('[kwerzo] Cannot connect to DB:', err.message);
    console.warn('[kwerzo] Falling back to in-memory storage');
    db.devMode = true;
    db.pool    = null;
    return;
  }

  // ── Schema ────────────────────────────────────────────────────────────────
  try {
    await runDDL(`
      CREATE TABLE IF NOT EXISTS kwerzo_users (
        id            SERIAL      PRIMARY KEY,
        username      VARCHAR(32) UNIQUE NOT NULL,
        email         VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT        NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `, 'kwerzo_users');

    await runDDL(`
      CREATE TABLE IF NOT EXISTS kwerzo_leaderboard (
        user_id      INTEGER PRIMARY KEY REFERENCES kwerzo_users(id) ON DELETE CASCADE,
        wins         INTEGER DEFAULT 0,
        losses       INTEGER DEFAULT 0,
        games_played INTEGER DEFAULT 0,
        total_score  INTEGER DEFAULT 0,
        elo_rating   INTEGER DEFAULT 1000
      )
    `, 'kwerzo_leaderboard');

    await runDDL(
      `ALTER TABLE kwerzo_leaderboard ADD COLUMN IF NOT EXISTS elo_rating  INTEGER DEFAULT 1000`,
      'elo_rating column'
    );
    await runDDL(
      `ALTER TABLE kwerzo_leaderboard ADD COLUMN IF NOT EXISTS total_score INTEGER DEFAULT 0`,
      'total_score column'
    );

    // Backfill: give every existing user a leaderboard row
    await runDDL(`
      INSERT INTO kwerzo_leaderboard (user_id)
      SELECT id FROM kwerzo_users
      ON CONFLICT (user_id) DO NOTHING
    `, 'backfill leaderboard');

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
    `, 'kwerzo_rooms');

    await runDDL(
      `CREATE INDEX IF NOT EXISTS idx_rooms_status   ON kwerzo_rooms(status)`,
      'idx_rooms_status'
    );
    await runDDL(
      `CREATE INDEX IF NOT EXISTS idx_rooms_activity ON kwerzo_rooms(last_activity_at)`,
      'idx_rooms_activity'
    );

    console.log('[kwerzo] DB schema ready');
  } catch (err) {
    console.error('[kwerzo] Schema init failed:', err.message);
    console.warn('[kwerzo] Falling back to in-memory storage');
    db.devMode = true;
    db.pool    = null;
  }
}

module.exports = { db, initDb, memDb, memNextId: () => memNextId++ };
