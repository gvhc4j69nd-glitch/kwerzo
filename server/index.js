'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');

const { initDb } = require('./db/schema');
const authRouter = require('./routes/auth');
const { router: leaderboardRouter, updateStats, BOT_DIFFICULTY_WEIGHT } = require('./routes/leaderboard');
const friendsRouter = require('./routes/friends');
const roomManager = require('./game/roomManager');
const presence = require('./presence');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });
presence.setIO(io);

const PORT = process.env.PORT || 3002;
const JWT_SECRET = process.env.JWT_SECRET || 'kwerzo-dev-secret';

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

app.use('/api/auth', authRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/friends', friendsRouter);

// Health / diagnostics endpoint — tells us immediately whether DB is wired up
app.get('/api/health', async (req, res) => {
  const { db } = require('./db/schema');
  if (db.devMode) {
    return res.json({
      status:  'degraded',
      mode:    'memory',
      message: 'DATABASE_URL is not set — data is lost on every restart. ' +
               'Add a PostgreSQL database in Railway and set DATABASE_URL.',
    });
  }
  try {
    const result = await db.pool.query(
      `SELECT
         (SELECT COUNT(*) FROM kwerzo_users)        AS users,
         (SELECT COUNT(*) FROM kwerzo_leaderboard)  AS lb_rows,
         (SELECT COUNT(*) FROM kwerzo_rooms)        AS rooms`
    );
    res.json({ status: 'ok', mode: 'postgres', stats: result.rows[0] });
  } catch (err) {
    res.status(500).json({ status: 'error', mode: 'postgres', message: err.message });
  }
});

// Serve built client
const clientDist = path.join(__dirname, '../client/dist');
app.use(express.static(clientDist));
app.get(/(.*)/, (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(clientDist, 'index.html'));
  }
});

// Socket.io auth middleware — verify JWT then refresh username from DB
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('No token'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = payload;
    // Always pull the current username from DB so renames take effect immediately
    try {
      const { db } = require('./db/schema');
      const row = db.devMode
        ? db.users?.find(u => u.id === payload.userId)
        : (await db.pool.query('SELECT username FROM kwerzo_users WHERE id = $1', [payload.userId])).rows[0];
      if (row?.username) socket.user = { ...payload, username: row.username };
    } catch (_) { /* fall back to JWT username if DB lookup fails */ }
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
  // Cancel any pending bot timer for this room
  const pending = botTimers.get(room.id);
  if (pending) { clearTimeout(pending); botTimers.delete(room.id); }
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
    const botPlayers = room.players.filter(p => p.isBot);
    const vsBots = botPlayers.length > 0;
    const botWeight = vsBots
      ? Math.max(...botPlayers.map(b => BOT_DIFFICULTY_WEIGHT[b.difficulty] ?? 1))
      : 1;
    updateStats(winners.filter(w => !room.players.find(p=>p.id===w.id)?.isBot).map(w=>w.id),
                realPlayerIds, scores, { vsBots, botWeight }).catch(console.error);
  }
}

// Per-room guard so concurrent scheduleBotMoves calls don't double-fire
const botTimers = new Map();

// Bots "think" for this long before placing — gives the UI time to show
// a "Bot thinking…" message and lets humans see the previous move first.
const BOT_THINK_DELAY = 3000;

// Trigger bot moves, chaining until a human's turn (or game over)
function scheduleBotMoves(roomId) {
  // If a timer is already pending for this room, don't schedule another
  if (botTimers.has(roomId)) return;

  const room = roomManager.getRoom(roomId);
  if (!room || room.status !== 'playing') return;

  const thinkingBot = roomManager.getCurrentBot(room);
  if (!thinkingBot) return;

  io.to(roomId).emit('bot_thinking', {
    roomId,
    botId: thinkingBot.id,
    username: thinkingBot.username,
  });

  const t = setTimeout(() => {
    botTimers.delete(roomId);

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

    const type = result.action;
    io.to(roomId).emit('move_made', {
      roomId,
      userId:   botPlayer.id,
      username: botPlayer.username,
      type:     type === 'place' ? undefined : type,
      points:   result.points,
      kwerzo:   result.kwerzo || false,
      count:    result.count,
    });
    broadcastGameState(updatedRoom);

    // If the next player is also a bot, chain another move
    const nextBot = roomManager.getCurrentBot(updatedRoom);
    if (nextBot) scheduleBotMoves(roomId);
  }, BOT_THINK_DELAY);

  botTimers.set(roomId, t);
}

io.on('connection', (socket) => {
  const { userId, username } = socket.user;
  console.log(`[kwerzo] ${username} connected`);
  presence.markOnline(userId).catch(console.error);

  socket.on('get_online_friends', async () => {
    try {
      const friendIds = await require('./db/friendsStore').getAcceptedFriendIds(userId);
      socket.emit('online_friends', friendIds.filter(id => presence.isOnline(id)));
    } catch (err) {
      console.error('[kwerzo] get_online_friends error:', err.message);
    }
  });

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

    // If it's currently a bot's turn (e.g. player backgrounded the app while
    // the bot was supposed to move), kick off the bot chain so it isn't stuck.
    if (activeRoom.status === 'playing') {
      const currentBot = roomManager.getCurrentBot(activeRoom);
      if (currentBot) scheduleBotMoves(activeRoom.id);
    }
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

  // ── Game invites: invite a friend to your room, they get a notification with accept/decline ──
  socket.on('invite_to_game', async ({ roomId, friendUserId }) => {
    const fail = (message) => socket.emit('game_invite_error', { roomId, friendUserId: Number(friendUserId), message });

    const room = roomManager.getRoom(roomId);
    if (!room) return fail('Room not found');
    if (!room.players.find(p => p.id === userId)) return fail('You are not in that room');
    if (room.status !== 'waiting') return fail('Game already in progress');
    if (room.players.length >= 4) return fail('Room is full');

    try {
      const friendIds = await require('./db/friendsStore').getAcceptedFriendIds(userId);
      if (!friendIds.includes(Number(friendUserId))) return fail('You can only invite friends');
    } catch (err) {
      console.error('[kwerzo] invite_to_game friend check error:', err.message);
      return fail('Server error');
    }

    const friendSockets = [...io.sockets.sockets.values()].filter(s => s.user?.userId === Number(friendUserId));
    if (friendSockets.length === 0) return fail('That friend is currently offline');
    if (room.players.find(p => p.id === Number(friendUserId))) return fail('That friend is already in the room');

    for (const fs of friendSockets) {
      fs.emit('game_invite_received', {
        roomId,
        fromUserId: userId,
        fromUsername: username,
        playerCount: room.players.length,
      });
    }
    socket.emit('game_invite_sent', { roomId, friendUserId: Number(friendUserId) });
  });

  socket.on('respond_game_invite', ({ roomId, action, fromUserId }) => {
    if (action === 'accept') {
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
      presence.emitToUser(Number(fromUserId), 'game_invite_accepted', { roomId, byUserId: userId, byUsername: username });
    } else {
      presence.emitToUser(Number(fromUserId), 'game_invite_declined', { roomId, byUserId: userId, byUsername: username });
    }
  });

  socket.on('add_bot', ({ roomId, difficulty }) => {
    const validDifficulties = ['easy', 'medium', 'hard', 'expert', 'legendary'];
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

  socket.on('delete_room', ({ roomId }) => {
    const result = roomManager.deleteRoom(roomId, userId);
    if (result.error) { socket.emit('error', result.error); return; }
    io.to(roomId).emit('room_deleted', { roomId });
    io.emit('rooms_list', roomManager.listOpenRooms());
  });

  socket.on('start_game', ({ roomId }) => {
    const result = roomManager.startGame(roomId, userId);
    if (result.error) { socket.emit('error', result.error); return; }
    broadcastRoomUpdate(roomId);
    broadcastGameState(result.room);
    io.to(roomId).emit('game_started', { roomId });
    // If first player is a bot, kick off bot chain
    scheduleBotMoves(roomId);
  });

  socket.on('place_tiles', ({ roomId, placements }) => {
    const result = roomManager.handleMove(roomId, userId, placements);
    if (result.error) { socket.emit('move_error', result.error); return; }

    const { room, result: moveResult } = result;

    if (room.status === 'finished') {
      handleGameOver(room);
    } else {
      io.to(roomId).emit('move_made', {
        roomId, userId, username,
        points: moveResult.points,
        kwerzo: moveResult.kwerzo || false,
      });
      broadcastGameState(room);
      scheduleBotMoves(roomId);
    }
  });

  socket.on('swap_tiles', ({ roomId, tiles }) => {
    const result = roomManager.handleSwap(roomId, userId, tiles);
    if (result.error) { socket.emit('move_error', result.error); return; }
    io.to(roomId).emit('move_made', { roomId, userId, username, type: 'swap', count: tiles.length });
    broadcastGameState(result.room);
    scheduleBotMoves(roomId);
  });

  socket.on('pass_turn', ({ roomId }) => {
    const result = roomManager.handlePass(roomId, userId);
    if (result.error) { socket.emit('move_error', result.error); return; }
    if (result.room.status === 'finished') {
      handleGameOver(result.room);
    } else {
      io.to(roomId).emit('move_made', { roomId, userId, username, type: 'pass' });
      broadcastGameState(result.room);
      scheduleBotMoves(roomId);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[kwerzo] ${username} disconnected`);
    presence.markOffline(userId).catch(console.error);
    const roomId = socketRooms.get(socket.id);
    if (roomId) {
      socketRooms.delete(socket.id);
      // For playing games, skip leaveRoom so reconnecting players are restored
      // via session_restored instead of being kicked out.
      if (roomManager.getRoom(roomId)?.status === 'playing') return;
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
