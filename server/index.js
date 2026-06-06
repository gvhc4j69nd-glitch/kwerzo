'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');

const { initDb } = require('./db/schema');
const authRouter = require('./routes/auth');
const { router: leaderboardRouter, updateStats } = require('./routes/leaderboard');
const roomManager = require('./game/roomManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'kwerzo-dev-secret';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/leaderboard', leaderboardRouter);

// Serve built client
const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));
app.get(/(.*)/, (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(clientDist, 'index.html'));
  }
});

// Socket.io auth middleware
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('No token'));
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

// Track socket → room mapping
const socketRooms = new Map();

function broadcastGameState(room) {
  for (const player of room.players) {
    if (player.isBot) continue;
    const playerSockets = [...io.sockets.sockets.values()]
      .filter(s => s.user?.userId === player.id);
    const state = roomManager.getRoomState(room, player.id);
    for (const s of playerSockets) {
      s.emit('game_update', { state, roomId: room.id });  // roomId lets client filter by room
    }
  }
}

function broadcastRoomUpdate(roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  io.to(roomId).emit('room_update', {
    id: room.id,
    hostId: room.hostId,
    players: room.players,
    status: room.status
  });
}

function handleGameOver(room) {
  const players = room.gameState.players;
  const maxScore = Math.max(...players.map(p => p.score));
  const winners  = players.filter(p => p.score === maxScore);
  const scores   = Object.fromEntries(players.map(p => [p.id, p.score]));

  broadcastGameState(room);
  io.to(room.id).emit('game_over', {
    roomId: room.id,
    players: players.map(p => ({
      id: p.id,
      username: room.players.find(rp => rp.id === p.id)?.username,
      score: p.score
    })),
    winners: winners.map(w => w.id)
  });

  const realPlayerIds = room.players.filter(p => !p.isBot).map(p => p.id);
  if (realPlayerIds.length > 0) {
    updateStats(winners.filter(w => !room.players.find(p=>p.id===w.id)?.isBot).map(w=>w.id),
                realPlayerIds, scores).catch(console.error);
  }
}

// Trigger bot moves, chaining until a human's turn (or game over)
function scheduleBotMoves(roomId, delayMs) {
  setTimeout(() => {
    const room = roomManager.getRoom(roomId);
    if (!room || room.status !== 'playing') return;

    const bot = roomManager.getCurrentBot(room);
    if (!bot) return;

    const outcome = roomManager.executeBotMove(roomId);
    if (!outcome) return;

    const { result, room: updatedRoom, bot: botPlayer } = outcome;

    if (updatedRoom.status === 'finished') {
      handleGameOver(updatedRoom);
      return;
    }

    broadcastGameState(updatedRoom);

    const type = result.action;
    io.to(roomId).emit('move_made', {
      roomId,
      userId:   botPlayer.id,
      username: botPlayer.username,
      type:     type === 'place' ? undefined : type,
      points:   result.points,
      count:    result.count,
    });

    // If the next player is also a bot, chain another move
    const nextBot = roomManager.getCurrentBot(updatedRoom);
    if (nextBot) scheduleBotMoves(roomId, 1200);
  }, delayMs);
}

io.on('connection', (socket) => {
  const { userId, username } = socket.user;
  console.log(`[kwerzo] ${username} connected`);

  // ── Restore any active game session ──────────────────────────────────────
  const activeRoom = roomManager.findActiveRoomForUser(userId);
  if (activeRoom) {
    socket.join(activeRoom.id);
    socketRooms.set(socket.id, activeRoom.id);
    const state = roomManager.getRoomState(activeRoom, userId);
    socket.emit('session_restored', {
      roomId: activeRoom.id,
      room: {
        id:      activeRoom.id,
        hostId:  activeRoom.hostId,
        players: activeRoom.players,
        status:  activeRoom.status,
      },
      state,
    });
    console.log(`[kwerzo] ${username} restored to room ${activeRoom.id}`);
  }

  socket.on('list_rooms', () => {
    socket.emit('rooms_list', roomManager.listOpenRooms());
  });

  socket.on('create_room', () => {
    const room = roomManager.createRoom(userId, username);
    socket.join(room.id);
    socketRooms.set(socket.id, room.id);
    socket.emit('room_joined', {
      roomId: room.id,
      room: { id: room.id, hostId: room.hostId, players: room.players, status: room.status }
    });
    socket.broadcast.emit('rooms_list', roomManager.listOpenRooms());
  });

  socket.on('join_room', ({ roomId }) => {
    const result = roomManager.joinRoom(roomId, userId, username);
    if (result.error) { socket.emit('error', result.error); return; }
    socket.join(roomId);
    socketRooms.set(socket.id, roomId);
    socket.emit('room_joined', {
      roomId,
      room: { id: roomId, hostId: result.room.hostId, players: result.room.players, status: result.room.status }
    });
    broadcastRoomUpdate(roomId);
    io.emit('rooms_list', roomManager.listOpenRooms());
  });

  socket.on('add_bot', ({ roomId, difficulty }) => {
    const validDifficulties = ['easy', 'medium', 'hard'];
    const diff = validDifficulties.includes(difficulty) ? difficulty : 'medium';
    const result = roomManager.addBot(roomId, diff);
    if (result.error) { socket.emit('error', result.error); return; }
    broadcastRoomUpdate(roomId);
  });

  socket.on('leave_room', ({ roomId }) => {
    const result = roomManager.leaveRoom(roomId, userId);
    socket.leave(roomId);
    socketRooms.delete(socket.id);
    if (!result.deleted) broadcastRoomUpdate(roomId);
    io.emit('rooms_list', roomManager.listOpenRooms());
  });

  socket.on('start_game', ({ roomId }) => {
    const result = roomManager.startGame(roomId, userId);
    if (result.error) { socket.emit('error', result.error); return; }
    broadcastRoomUpdate(roomId);
    broadcastGameState(result.room);
    io.to(roomId).emit('game_started', { roomId });
    // If first player is a bot, kick off bot chain
    scheduleBotMoves(roomId, 1000);
  });

  socket.on('place_tiles', ({ roomId, placements }) => {
    const result = roomManager.handleMove(roomId, userId, placements);
    if (result.error) { socket.emit('move_error', result.error); return; }

    const { room, result: moveResult } = result;

    if (room.status === 'finished') {
      handleGameOver(room);
    } else {
      broadcastGameState(room);
      io.to(roomId).emit('move_made', {
        roomId, userId, username,
        points: moveResult.points,
      });
      scheduleBotMoves(roomId, 900);
    }
  });

  socket.on('swap_tiles', ({ roomId, tiles }) => {
    const result = roomManager.handleSwap(roomId, userId, tiles);
    if (result.error) { socket.emit('move_error', result.error); return; }
    broadcastGameState(result.room);
    io.to(roomId).emit('move_made', { roomId, userId, username, type: 'swap', count: tiles.length });
    scheduleBotMoves(roomId, 900);
  });

  socket.on('pass_turn', ({ roomId }) => {
    const result = roomManager.handlePass(roomId, userId);
    if (result.error) { socket.emit('move_error', result.error); return; }
    if (result.room.status === 'finished') {
      handleGameOver(result.room);
    } else {
      broadcastGameState(result.room);
      io.to(roomId).emit('move_made', { roomId, userId, username, type: 'pass' });
      scheduleBotMoves(roomId, 900);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[kwerzo] ${username} disconnected`);
    const roomId = socketRooms.get(socket.id);
    if (roomId) {
      socketRooms.delete(socket.id);
      setTimeout(() => {
        const stillConnected = [...io.sockets.sockets.values()]
          .some(s => s.user?.userId === userId && s.id !== socket.id);
        if (!stillConnected) {
          const result = roomManager.leaveRoom(roomId, userId);
          if (!result.deleted) broadcastRoomUpdate(roomId);
          io.emit('rooms_list', roomManager.listOpenRooms());
        }
      }, 30000);
    }
  });
});

async function start() {
  await initDb();

  // Load persisted rooms back into memory
  await roomManager.loadPersistedRooms();

  // Purge rooms inactive > 72 h every hour
  const HOUR = 60 * 60 * 1000;
  setInterval(async () => {
    const purged = await roomManager.purgeInactiveRooms();
    for (const roomId of purged) {
      io.to(roomId).emit('room_expired', { roomId, reason: '72h inactivity' });
    }
  }, HOUR);

  server.listen(PORT, () => console.log(`[kwerzo] Server running on port ${PORT}`));
}

start().catch(console.error);
