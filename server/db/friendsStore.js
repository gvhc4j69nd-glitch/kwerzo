'use strict';

const { db, memDb, memNextFriendId } = require('./schema');

// ── helpers for in-memory mode ───────────────────────────────────────────────
function memUserById(id) {
  return memDb.users.find(u => u.id === id) || null;
}
function memUserByUsername(name) {
  const lname = name.trim().toLowerCase();
  return memDb.users.find(u => u.username.toLowerCase() === lname) || null;
}
function memRecordBetween(aId, bId) {
  return memDb.friends.find(f =>
    (f.requesterId === aId && f.addresseeId === bId) ||
    (f.requesterId === bId && f.addresseeId === aId)
  ) || null;
}

// ── search users by username (excluding self) ───────────────────────────────
async function searchUsers(query, selfId) {
  const q = (query || '').trim();
  if (!q) return [];

  if (db.devMode) {
    const lq = q.toLowerCase();
    return memDb.users
      .filter(u => u.id !== selfId && u.username.toLowerCase().includes(lq))
      .slice(0, 20)
      .map(u => ({ id: u.id, username: u.username }));
  }

  const { rows } = await db.pool.query(
    `SELECT id, username FROM kwerzo_users
     WHERE id != $1 AND username ILIKE $2
     ORDER BY username ASC LIMIT 20`,
    [selfId, `%${q}%`]
  );
  return rows;
}

// ── full friends snapshot: accepted / incoming / outgoing ───────────────────
async function getFriendsData(userId) {
  if (db.devMode) {
    const records = memDb.friends.filter(f => f.requesterId === userId || f.addresseeId === userId);
    const friends  = [];
    const incoming = [];
    const outgoing = [];
    for (const f of records) {
      const otherId = f.requesterId === userId ? f.addresseeId : f.requesterId;
      const other   = memUserById(otherId);
      if (!other) continue;
      const entry = { id: f.id, userId: other.id, username: other.username };
      if (f.status === 'accepted') friends.push(entry);
      else if (f.status === 'pending') {
        if (f.addresseeId === userId) incoming.push(entry);
        else outgoing.push(entry);
      }
    }
    return { friends, incoming, outgoing };
  }

  const { rows } = await db.pool.query(`
    SELECT f.id, f.status, f.requester_id, f.addressee_id,
           u.id AS other_id, u.username AS other_username
    FROM kwerzo_friends f
    JOIN kwerzo_users u
      ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
    WHERE f.requester_id = $1 OR f.addressee_id = $1
  `, [userId]);

  const friends  = [];
  const incoming = [];
  const outgoing = [];
  for (const r of rows) {
    const entry = { id: r.id, userId: r.other_id, username: r.other_username };
    if (r.status === 'accepted') friends.push(entry);
    else if (r.status === 'pending') {
      if (r.addressee_id === userId) incoming.push(entry);
      else outgoing.push(entry);
    }
  }
  return { friends, incoming, outgoing };
}

// ── list of accepted-friend user IDs (for presence broadcasts) ──────────────
async function getAcceptedFriendIds(userId) {
  if (db.devMode) {
    return memDb.friends
      .filter(f => f.status === 'accepted' && (f.requesterId === userId || f.addresseeId === userId))
      .map(f => (f.requesterId === userId ? f.addresseeId : f.requesterId));
  }
  const { rows } = await db.pool.query(
    `SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS friend_id
     FROM kwerzo_friends WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)`,
    [userId]
  );
  return rows.map(r => r.friend_id);
}

// ── send a friend request by username ───────────────────────────────────────
// Returns { error } | { status: 'requested' | 'accepted', addresseeId, requestId }
async function sendRequest(requesterId, requesterUsername, addresseeUsername) {
  const name = (addresseeUsername || '').trim();
  if (!name) return { error: 'Username is required' };
  if (name.toLowerCase() === requesterUsername.toLowerCase()) {
    return { error: 'You cannot add yourself' };
  }

  if (db.devMode) {
    const addressee = memUserByUsername(name);
    if (!addressee) return { error: 'User not found' };

    const existing = memRecordBetween(requesterId, addressee.id);
    if (existing) {
      if (existing.status === 'accepted') return { error: 'Already friends' };
      // pending in either direction
      if (existing.requesterId === requesterId) return { error: 'Friend request already sent' };
      // they already requested us — auto-accept
      existing.status = 'accepted';
      return { status: 'accepted', addresseeId: addressee.id, requestId: existing.id };
    }

    const record = {
      id: memNextFriendId(),
      requesterId,
      addresseeId: addressee.id,
      status: 'pending',
      createdAt: new Date(),
    };
    memDb.friends.push(record);
    return { status: 'requested', addresseeId: addressee.id, requestId: record.id };
  }

  const { rows: addresseeRows } = await db.pool.query(
    `SELECT id, username FROM kwerzo_users WHERE LOWER(username) = LOWER($1)`,
    [name]
  );
  const addressee = addresseeRows[0];
  if (!addressee) return { error: 'User not found' };

  const { rows: existingRows } = await db.pool.query(
    `SELECT * FROM kwerzo_friends
     WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
    [requesterId, addressee.id]
  );
  const existing = existingRows[0];
  if (existing) {
    if (existing.status === 'accepted') return { error: 'Already friends' };
    if (existing.requester_id === requesterId) return { error: 'Friend request already sent' };
    await db.pool.query(`UPDATE kwerzo_friends SET status = 'accepted' WHERE id = $1`, [existing.id]);
    return { status: 'accepted', addresseeId: addressee.id, requestId: existing.id };
  }

  const { rows: inserted } = await db.pool.query(
    `INSERT INTO kwerzo_friends (requester_id, addressee_id, status) VALUES ($1, $2, 'pending') RETURNING id`,
    [requesterId, addressee.id]
  );
  return { status: 'requested', addresseeId: addressee.id, requestId: inserted[0].id };
}

// ── accept / decline an incoming request ────────────────────────────────────
// Returns { error } | { status: 'accepted' | 'declined', otherUserId }
async function respondToRequest(userId, requestId, action) {
  if (db.devMode) {
    const record = memDb.friends.find(f => f.id === requestId && f.addresseeId === userId && f.status === 'pending');
    if (!record) return { error: 'Request not found' };
    if (action === 'accept') {
      record.status = 'accepted';
      return { status: 'accepted', otherUserId: record.requesterId };
    }
    memDb.friends = memDb.friends.filter(f => f.id !== requestId);
    return { status: 'declined', otherUserId: record.requesterId };
  }

  const { rows } = await db.pool.query(
    `SELECT * FROM kwerzo_friends WHERE id = $1 AND addressee_id = $2 AND status = 'pending'`,
    [requestId, userId]
  );
  const record = rows[0];
  if (!record) return { error: 'Request not found' };

  if (action === 'accept') {
    await db.pool.query(`UPDATE kwerzo_friends SET status = 'accepted' WHERE id = $1`, [requestId]);
    return { status: 'accepted', otherUserId: record.requester_id };
  }
  await db.pool.query(`DELETE FROM kwerzo_friends WHERE id = $1`, [requestId]);
  return { status: 'declined', otherUserId: record.requester_id };
}

// ── remove a friend / cancel an outgoing request ────────────────────────────
// `id` is the friends-table row id; returns { error } | { otherUserId }
async function removeRecord(userId, id) {
  if (db.devMode) {
    const record = memDb.friends.find(f => f.id === id && (f.requesterId === userId || f.addresseeId === userId));
    if (!record) return { error: 'Not found' };
    memDb.friends = memDb.friends.filter(f => f.id !== id);
    return { otherUserId: record.requesterId === userId ? record.addresseeId : record.requesterId };
  }

  const { rows } = await db.pool.query(
    `SELECT * FROM kwerzo_friends WHERE id = $1 AND (requester_id = $2 OR addressee_id = $2)`,
    [id, userId]
  );
  const record = rows[0];
  if (!record) return { error: 'Not found' };
  await db.pool.query(`DELETE FROM kwerzo_friends WHERE id = $1`, [id]);
  return { otherUserId: record.requester_id === userId ? record.addressee_id : record.requester_id };
}

module.exports = {
  searchUsers,
  getFriendsData,
  getAcceptedFriendIds,
  sendRequest,
  respondToRequest,
  removeRecord,
};
