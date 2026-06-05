'use strict';

const { createInitialState, applyMove, applySwap, applyPass, getStateForPlayer } = require('./kwerzoEngine');
const { getBotMove } = require('./botAI');

const rooms = new Map();

function generateId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

const BOT_NAMES = {
  easy:   ['Pixel', 'Wobble', 'Doodle', 'Blinky', 'Zippy'],
  medium: ['Nova', 'Cipher', 'Axiom', 'Prism', 'Vector'],
  hard:   ['Nexus', 'Oracle', 'Titan', 'Apex', 'Zenith'],
};

function addBot(roomId, difficulty) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.status !== 'waiting') return { error: 'Game already in progress' };
  if (room.players.length >= 4) return { error: 'Room is full (max 4 players)' };

  const names = BOT_NAMES[difficulty] || BOT_NAMES.medium;
  const usedNames = room.players.map(p => p.username);
  const available = names.filter(n => !usedNames.includes(`${n} (Bot)`));
  const name = available.length > 0
    ? `${available[0]} (Bot)`
    : `Bot ${room.players.length + 1}`;

  const botId = `bot_${difficulty}_${generateId()}`;
  room.players.push({ id: botId, username: name, isBot: true, difficulty });
  return { room };
}

function createRoom(hostId, hostUsername) {
  const roomId = generateId();
  const room = {
    id: roomId,
    hostId,
    players: [{ id: hostId, username: hostUsername }],
    status: 'waiting',
    gameState: null,
    createdAt: Date.now()
  };
  rooms.set(roomId, room);
  return room;
}

function joinRoom(roomId, userId, username) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.status !== 'waiting') return { error: 'Game already in progress' };
  if (room.players.length >= 4) return { error: 'Room is full (max 4 players)' };
  if (room.players.find(p => p.id === userId)) return { error: 'Already in room' };

  room.players.push({ id: userId, username });
  return { room };
}

function leaveRoom(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };

  room.players = room.players.filter(p => p.id !== userId);

  if (room.players.length === 0) {
    rooms.delete(roomId);
    return { deleted: true };
  }

  if (room.hostId === userId && room.players.length > 0) {
    room.hostId = room.players[0].id;
  }

  if (room.status === 'playing' && room.gameState) {
    // Remove player from game state
    room.gameState.players = room.gameState.players.filter(p => p.id !== userId);
    room.gameState.turnOrder = room.gameState.turnOrder.filter(id => id !== userId);
    if (room.gameState.players.length < 2) {
      room.status = 'finished';
      if (room.gameState.players.length === 1) {
        room.gameState.status = 'finished';
      }
    }
    // Fix currentPlayerIndex if out of bounds
    if (room.gameState.currentPlayerIndex >= room.gameState.players.length) {
      room.gameState.currentPlayerIndex = 0;
    }
  }

  return { room };
}

function startGame(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.hostId !== userId) return { error: 'Only the host can start the game' };
  if (room.players.length < 2) return { error: 'Need at least 2 players to start' };
  if (room.status !== 'waiting') return { error: 'Game already started' };

  const playerIds = room.players.map(p => p.id);
  room.gameState = createInitialState(playerIds);
  room.status = 'playing';
  return { room };
}

// Returns bot player info if the current turn belongs to a bot
function getCurrentBot(room) {
  if (!room.gameState || room.status !== 'playing') return null;
  const idx = room.gameState.currentPlayerIndex;
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
    if (result.error) {
      // Fallback to pass on unexpected error
      result = applyPass(room.gameState, bot.id);
      result.action = 'pass';
    } else {
      result.action = 'place';
    }
  } else if (decision.action === 'swap') {
    result = applySwap(room.gameState, bot.id, decision.tiles);
    if (result.error) {
      result = applyPass(room.gameState, bot.id);
      result.action = 'pass';
    } else {
      result.action = 'swap';
      result.count  = decision.tiles.length;
    }
  } else {
    result = applyPass(room.gameState, bot.id);
    result.action = 'pass';
  }

  if (result.error) return null;

  room.gameState = result.newState;
  if (room.gameState.status === 'finished') room.status = 'finished';

  return { result, room, bot };
}

function handleMove(roomId, userId, placements) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.status !== 'playing') return { error: 'Game is not active' };

  const result = applyMove(room.gameState, userId, placements);
  if (result.error) return { error: result.error };

  room.gameState = result.newState;
  if (room.gameState.status === 'finished') room.status = 'finished';

  return { result, room };
}

function handleSwap(roomId, userId, tiles) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.status !== 'playing') return { error: 'Game is not active' };

  const result = applySwap(room.gameState, userId, tiles);
  if (result.error) return { error: result.error };

  room.gameState = result.newState;
  return { result, room };
}

function handlePass(roomId, userId) {
  const room = rooms.get(roomId);
  if (!room) return { error: 'Room not found' };
  if (room.status !== 'playing') return { error: 'Game is not active' };

  const result = applyPass(room.gameState, userId);
  if (result.error) return { error: result.error };

  room.gameState = result.newState;
  return { result, room };
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function listOpenRooms() {
  return Array.from(rooms.values())
    .filter(r => r.status === 'waiting')
    .map(r => ({
      id: r.id,
      hostId: r.hostId,
      playerCount: r.players.length,
      players: r.players.map(p => p.username),
      createdAt: r.createdAt
    }));
}

function getRoomState(room, userId) {
  if (!room.gameState) return null;
  return getStateForPlayer(room.gameState, userId);
}

module.exports = {
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
  getRoom,
  listOpenRooms,
  getRoomState
};
