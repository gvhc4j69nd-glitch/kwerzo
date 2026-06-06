'use strict';
/**
 * roomStore.js — persists room/game state to PostgreSQL (or in-memory in dev mode).
 *
 * Each room row stores:
 *   room_id        – 6-char code
 *   host_id        – userId of host
 *   status         – 'waiting' | 'playing' | 'finished'
 *   players        – JSON array of player objects (includes isBot, difficulty)
 *   game_state     – full gameState JSON (board, bag, hands, …)
 *   created_at
 *   last_activity_at – updated on every move; used for 72-h cleanup
 */

const { db } = require('./schema');

const INACTIVITY_LIMIT_MS = 72 * 60 * 60 * 1000; // 72 hours

// In-memory fallback store (mirrors the Map in roomManager, but we don't need a
// separate structure — devMode rooms live only in roomManager's Map)
const memRooms = new Map();

// ── Ensure table exists ──────────────────────────────────────────────────────
async function ensureTable() {
  if (db.devMode) return;
  await db.pool.query(`
    CREATE TABLE IF NOT EXISTS kwerzo_rooms (
      room_id          VARCHAR(16) PRIMARY KEY,
      host_id          TEXT        NOT NULL,
      status           VARCHAR(16) NOT NULL DEFAULT 'waiting',
      players          JSONB       NOT NULL DEFAULT '[]',
      game_state       JSONB,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_rooms_status ON kwerzo_rooms(status);
    CREATE INDEX IF NOT EXISTS idx_rooms_activity ON kwerzo_rooms(last_activity_at);
  `);
}

// ── Save / upsert a room ─────────────────────────────────────────────────────
async function saveRoom(room) {
  if (db.devMode) {
    memRooms.set(room.id, JSON.parse(JSON.stringify(room)));
    return;
  }
  try {
    await db.pool.query(
      `INSERT INTO kwerzo_rooms
         (room_id, host_id, status, players, game_state, last_activity_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (room_id) DO UPDATE SET
         host_id          = EXCLUDED.host_id,
         status           = EXCLUDED.status,
         players          = EXCLUDED.players,
         game_state       = EXCLUDED.game_state,
         last_activity_at = NOW()`,
      [
        room.id,
        String(room.hostId),
        room.status,
        JSON.stringify(room.players),
        room.gameState ? JSON.stringify(room.gameState) : null,
      ]
    );
  } catch (err) {
    console.error('[roomStore] saveRoom error:', err.message);
  }
}

// ── Delete a room ────────────────────────────────────────────────────────────
async function deleteRoom(roomId) {
  if (db.devMode) { memRooms.delete(roomId); return; }
  try {
    await db.pool.query('DELETE FROM kwerzo_rooms WHERE room_id = $1', [roomId]);
  } catch (err) {
    console.error('[roomStore] deleteRoom error:', err.message);
  }
}

// ── Load all active rooms at startup ─────────────────────────────────────────
async function loadAllRooms() {
  if (db.devMode) return [];
  try {
    const cutoff = new Date(Date.now() - INACTIVITY_LIMIT_MS).toISOString();
    const { rows } = await db.pool.query(
      `SELECT room_id, host_id, status, players, game_state, last_activity_at
       FROM kwerzo_rooms
       WHERE status != 'finished'
         AND last_activity_at > $1
       ORDER BY created_at ASC`,
      [cutoff]
    );
    return rows.map(r => ({
      id:         r.room_id,
      hostId:     r.host_id,
      status:     r.status,
      players:    r.players,
      gameState:  r.game_state,
      createdAt:  new Date(r.created_at).getTime(),
      lastMoveAt: new Date(r.last_activity_at).getTime(),
    }));
  } catch (err) {
    console.error('[roomStore] loadAllRooms error:', err.message);
    return [];
  }
}

// ── Cleanup rooms inactive for 72 h ─────────────────────────────────────────
async function purgeInactiveRooms() {
  if (db.devMode) return [];
  try {
    const cutoff = new Date(Date.now() - INACTIVITY_LIMIT_MS).toISOString();
    const { rows } = await db.pool.query(
      `DELETE FROM kwerzo_rooms
       WHERE last_activity_at <= $1
       RETURNING room_id`,
      [cutoff]
    );
    const ids = rows.map(r => r.room_id);
    if (ids.length > 0) console.log(`[roomStore] Purged ${ids.length} inactive room(s):`, ids);
    return ids;
  } catch (err) {
    console.error('[roomStore] purgeInactiveRooms error:', err.message);
    return [];
  }
}

module.exports = { ensureTable, saveRoom, deleteRoom, loadAllRooms, purgeInactiveRooms, INACTIVITY_LIMIT_MS };
