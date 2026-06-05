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

function broadcastGameState(room) {
  for (const player of room.players) {
    const playerSockets = [...io.sockets.sockets.values()]
      .filter(s => s.user?.userId === player.id);
    const state = roomManager.getRoomState(room, player.id);
    for (const s of playerSockets) {
      s.emit('game_update', { state, roomId: room.id });
    }
  }
}

io.on('connection', (socket) => {
  const { userId, username } = socket.user;
  console.log(`[kwerzo] ${username} connected`);

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
    // Notify lobby of new room
    socket.broadcast.emit('rooms_list', roomManager.listOpenRooms());
  });

  socket.on('join_room', ({ roomId }) => {
    const result = roomManager.joinRoom(roomId, userId, username);
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }
    socket.join(roomId);
    socketRooms.set(socket.id, roomId);
    socket.emit('room_joined', {
      roomId,
      room: { id: roomId, hostId: result.room.hostId, players: result.room.players, status: result.room.status }
    });
    broadcastRoomUpdate(roomId);
    io.emit('rooms_list', roomManager.listOpenRooms());
  });

  socket.on('leave_room', ({ roomId }) => {
    const result = roomManager.leaveRoom(roomId, userId);
    socket.leave(roomId);
    socketRooms.delete(socket.id);
    if (!result.deleted) {
      broadcastRoomUpdate(roomId);
    }
    io.emit('rooms_list', roomManager.listOpenRooms());
  });

  socket.on('start_game', ({ roomId }) => {
    const result = roomManager.startGame(roomId, userId);
    if (result.error) {
      socket.emit('error', result.error);
      return;
    }
    broadcastRoomUpdate(roomId);
    broadcastGameState(result.room);
    io.to(roomId).emit('game_started', { roomId });
  });

  socket.on('place_tiles', ({ roomId, placements }) => {
    const result = roomManager.handleMove(roomId, userId, placements);
    if (result.error) {
      socket.emit('move_error', result.error);
      return;
    }

    const { room, result: moveResult } = result;

    if (room.gameState.status === 'finished') {
      const players = room.gameState.players;
      const maxScore = Math.max(...players.map(p => p.score));
      const winners = players.filter(p => p.score === maxScore);
      const scores = Object.fromEntries(players.map(p => [p.id, p.score]));

      broadcastGameState(room);
      io.to(roomId).emit('game_over', {
        roomId,
        players: players.map(p => ({
          id: p.id,
          username: room.players.find(rp => rp.id === p.id)?.username,
          score: p.score
        })),
        winners: winners.map(w => w.id)
      });

      // Persist stats (non-awaited)
      const realPlayerIds = room.players.map(p => p.id);
      updateStats(winners.map(w => w.id), realPlayerIds, scores).catch(console.error);
    } else {
      broadcastGameState(room);
      io.to(roomId).emit('move_made', {
        roomId,
        userId,
        username,
        placements,
        points: moveResult.points
      });
    }
  });

  socket.on('swap_tiles', ({ roomId, tiles }) => {
    const result = roomManager.handleSwap(roomId, userId, tiles);
    if (result.error) {
      socket.emit('move_error', result.error);
      return;
    }
    broadcastGameState(result.room);
    io.to(roomId).emit('move_made', {
      roomId,
      userId,
      username,
      type: 'swap',
      count: tiles.length
    });
  });

  socket.on('pass_turn', ({ roomId }) => {
    const result = roomManager.handlePass(roomId, userId);
    if (result.error) {
      socket.emit('move_error', result.error);
      return;
    }
    broadcastGameState(result.room);
    io.to(roomId).emit('move_made', { roomId, userId, username, type: 'pass' });
  });

  socket.on('disconnect', () => {
    console.log(`[kwerzo] ${username} disconnected`);
    const roomId = socketRooms.get(socket.id);
    if (roomId) {
      socketRooms.delete(socket.id);
      // Give 30s grace period before removing from room (reconnect window)
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
  server.listen(PORT, () => console.log(`[kwerzo] Server running on port ${PORT}`));
}

start().catch(console.error);
