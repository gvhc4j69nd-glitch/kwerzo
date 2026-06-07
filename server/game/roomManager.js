'use strict';

const { createInitialState, applyMove, applySwap, applyPass, getStateForPlayer } = require('./kwerzoEngine');
const { getBotMove } = require('./botAI');
const roomStore = require('../db/roomStore');

const rooms = new Map();

function generateId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const BOT_NAMES = {
  easy:   ['Joe', 'Pixel', 'Doodle', 'Blinky', 'Zippy'],
  medium: ['Nova', 'Cipher', 'Axiom', 'Prism', 'Vector'],
  hard:   ['John', 'Titan', 'Apex', 'Zenith', 'Oracle'],
};

// ── Persist helper — fire-and-forget so game logic stays synchronous ──────────
function persist(room) {
  roomStore.saveRoom(room).catch(err => console.error('[roomManager] persist error:', err.message));
}
function remove(roomId) {
  roomStore.deleteRoom(roomId).catch(err => console.error('[roomManager] remove error:', err.message));
}

// ── Hydrate rooms from DB at startup ─────────────────────────────────────────
async function loadPersistedRooms() {
  const rows = await roomStore.loadAllRooms();
  for (const row of rows) {
    rooms.set(row.id, row);
  }
  console.log(`[roomManager] Loaded ${rows.length} persisted room(s)`);
}

// ── Purge rooms inactive > 72 h (returns purged IDs) ─────────────────────────
async function purgeInactiveRooms() {
  const purgedIds = await roomStore.purgeInactiveRooms();
  for (const id of purgedIds) rooms.delete(id);
  return purgedIds;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

function addBot(roomId, difficulty) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.status !== 'waiting') return { error: 'Game already in progress' };
  if (room.players.length >= 4) return { error: 'Room is full (max 4 players)' };

  const names    = BOT_NAMES[difficulty] || BOT_NAMES.medium;
  const usedNames = room.players.map(p => p.username);
  const available = names.filter(n => !usedNames.includes(`${n} (Bot)`));
  const name = available.length > 0 ? `${available[0]} (Bot)` : `Bot ${room.players.length + 1}`;

  const botId = `bot_${difficulty}_${generateId()}`;
  room.players.push({ id: botId, username: name, isBot: true, difficulty });
  persist(room);
  return { room };
}

function createRoom(hostId, hostUsername) {
  const roomId = generateId();
  const room = {
    id: roomId,
    hostId,
    players:   [{ id: hostId, username: hostUsername }],
    status:    'waiting',
    gameState: null,
    createdAt: Date.now(),
  };
  rooms.set(roomId, room);
  persist(room);
  return room;
}

function joinRoom(roomId, userId, username) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.status !== 'waiting') return { error: 'Game already in progress' };
  if (room.players.length >= 4) return { error: 'Room is full (max 4 players)' };
  if (room.players.find(p => p.id === userId)) return { error: 'Already in room' };

  room.players.push({ id: userId, username });
  persist(room);
  return { room };
}

function leaveRoom(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  room.players = room.players.filter(p => p.id !== userId);

  if (room.players.length === 0) {
    rooms.delete(roomId);
    remove(roomId);
    return { deleted: true };
  }

  if (room.hostId === userId && room.players.length > 0) {
    room.hostId = room.players[0].id;
  }

  if (room.status === 'playing' && room.gameState) {
    room.gameState.players   = room.gameState.players.filter(p => p.id !== userId);
    room.gameState.turnOrder = (room.gameState.turnOrder || []).filter(id => id !== userId);
    if (room.gameState.players.length < 2) {
      room.status            = 'finished';
      room.gameState.status  = 'finished';
    }
    if (room.gameState.currentPlayerIndex >= room.gameState.players.length) {
      room.gameState.currentPlayerIndex = 0;
    }
  }

  persist(room);
  return { room };
}

function startGame(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (String(room.hostId) !== String(userId)) return { error: 'Only the host can start the game' };
  if (room.players.length < 2) return { error: 'Need at least 2 players to start' };
  if (room.status !== 'waiting') return { error: 'Game already started' };

  const playerIds   = room.players.map(p => p.id);
  room.gameState    = createInitialState(playerIds);
  room.status       = 'playing';
  persist(room);
  return { room };
}

// ── Bot helpers ───────────────────────────────────────────────────────────────

function getCurrentBot(room) {
  if (!room.gameState || room.status !== 'playing') return null;
  const idx    = room.gameState.currentPlayerIndex;
  const player = room.players[idx];
  if (!player || !player.isBot) return null;
  const gsPlayer = room.gameState.players[idx];
  if (!gsPlayer) return null;
  return { ...player, hand: gsPlayer.hand };
}

function executeBotMove(roomId) {
  const room = rooms.get(roomId);
  if (!room) return null;

  const bot = getCurrentBot(room);
  if (!bot) return null;

  const decision = getBotMove(room.gameState, bot.id, bot.difficulty);

  let result;
  if (decision.action === 'place') {
    result = applyMove(room.gameState, bot.id, decision.placements);
    if (result.error) { result = applyPass(room.gameState, bot.id); result.action = 'pass'; }
    else               result.action = 'place';
  } else if (decision.action === 'swap') {
    result = applySwap(room.gameState, bot.id, decision.tiles);
    if (result.error) { result = applyPass(room.gameState, bot.id); result.action = 'pass'; }
    else               { result.action = 'swap'; result.count = decision.tiles.length; }
  } else {
    result = applyPass(room.gameState, bot.id);
    result.action = 'pass';
  }

  if (result.error) return null;

  room.gameState = result.newState;
  if (room.gameState.status === 'finished') room.status = 'finished';
  persist(room);

  return { result, room, bot };
}

// ── Game moves ────────────────────────────────────────────────────────────────

function handleMove(roomId, userId, placements) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.status !== 'playing') return { error: 'Game is not active' };

  const result = applyMove(room.gameState, userId, placements);
  if (result.error) return { error: result.error };

  room.gameState = result.newState;
  if (room.gameState.status === 'finished') room.status = 'finished';
  persist(room);
  return { result, room };
}

function handleSwap(roomId, userId, tiles) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.status !== 'playing') return { error: 'Game is not active' };

  const result = applySwap(room.gameState, userId, tiles);
  if (result.error) return { error: result.error };

  room.gameState = result.newState;
  persist(room);
  return { result, room };
}

function handlePass(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.status !== 'playing') return { error: 'Game is not active' };

  const result = applyPass(room.gameState, userId);
  if (result.error) return { error: result.error };

  room.gameState = result.newState;
  if (room.gameState.status === 'finished') room.status = 'finished';
  persist(room);
  return { result, room };
}

// ── Queries ───────────────────────────────────────────────────────────────────

function getRoom(roomId) { return rooms.get(roomId); }

/** Find any active (playing) room that contains this userId */
function findActiveRoomForUser(userId) {
  for (const room of rooms.values()) {
    if (room.status === 'playing' && room.players.some(p => p.id === userId && !p.isBot)) {
      return room;
    }
  }
  return null;
}

function listOpenRooms() {
  return Array.from(rooms.values())
    .filter(r => r.status === 'waiting')
    .map(r => ({
      id:          r.id,
      hostId:      r.hostId,
      playerCount: r.players.length,
      players:     r.players.map(p => p.username),
      createdAt:   r.createdAt,
    }));
}

function getRoomState(room, userId) {
  if (!room.gameState) return null;
  return getStateForPlayer(room.gameState, userId);
}

module.exports = {
  loadPersistedRooms,
  purgeInactiveRooms,
  createRoom,
  joinRoom,
  leaveRoom,
  addBot,
  startGame,
  handleMove,
  handleSwap,
  handlePass,
  getCurrentBot,
  executeBotMove,
  findActiveRoomForUser,
  getRoom,
  listOpenRooms,
  getRoomState,
};
