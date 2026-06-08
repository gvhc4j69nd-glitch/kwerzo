'use strict';

// Tracks which users currently have at least one open socket connection,
// and notifies their accepted friends when their online status changes.

const friendsStore = require('./db/friendsStore');

let ioRef = null;
const onlineCounts = new Map(); // userId -> number of open sockets

function setIO(io) {
  ioRef = io;
}

function isOnline(userId) {
  return onlineCounts.has(userId);
}

function emitToUser(userId, event, payload) {
  if (!ioRef) return;
  for (const s of ioRef.sockets.sockets.values()) {
    if (s.user?.userId === userId) s.emit(event, payload);
  }
}

async function markOnline(userId) {
  const count = (onlineCounts.get(userId) || 0) + 1;
  onlineCounts.set(userId, count);
  if (count === 1) {
    try {
      const friendIds = await friendsStore.getAcceptedFriendIds(userId);
      for (const fid of friendIds) emitToUser(fid, 'friend_online', { userId });
    } catch (err) {
      console.error('[presence] markOnline broadcast error:', err.message);
    }
  }
}

async function markOffline(userId) {
  const count = (onlineCounts.get(userId) || 1) - 1;
  if (count <= 0) {
    onlineCounts.delete(userId);
    try {
      const friendIds = await friendsStore.getAcceptedFriendIds(userId);
      for (const fid of friendIds) emitToUser(fid, 'friend_offline', { userId });
    } catch (err) {
      console.error('[presence] markOffline broadcast error:', err.message);
    }
  } else {
    onlineCounts.set(userId, count);
  }
}

module.exports = { setIO, isOnline, markOnline, markOffline, emitToUser };
