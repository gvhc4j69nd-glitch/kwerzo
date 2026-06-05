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

async function initDb() {
  if (db.devMode) {
    console.log('[kwerzo] No DATABASE_URL — running with in-memory storage');
    return;
  }
  try {
    await db.pool.query(`
      CREATE TABLE IF NOT EXISTS kwerzo_users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(32) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS kwerzo_leaderboard (
        user_id INTEGER PRIMARY KEY REFERENCES kwerzo_users(id) ON DELETE CASCADE,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        games_played INTEGER DEFAULT 0,
        total_score INTEGER DEFAULT 0,
        elo_rating INTEGER DEFAULT 1000
      );
    `);
    console.log('[kwerzo] DB initialized');
  } catch (err) {
    console.warn('[kwerzo] DB unavailable — falling back to in-memory storage:', err.message);
    db.devMode = true;
    db.pool = null;
  }
}

module.exports = { db, initDb, memDb, memNextId: () => memNextId++ };
