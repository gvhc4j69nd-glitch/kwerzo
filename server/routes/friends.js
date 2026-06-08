'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const friendsStore = require('../db/friendsStore');
const presence = require('../presence');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'kwerzo-dev-secret';

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(auth.replace('Bearer ', ''), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

router.use(authMiddleware);

// Search for users by (partial) username
router.get('/search', async (req, res) => {
  try {
    const results = await friendsStore.searchUsers(req.query.q, req.user.userId);
    res.json({ results: results.map(u => ({ ...u, online: presence.isOnline(u.id) })) });
  } catch (err) {
    console.error('[friends] search error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Full snapshot: friends (with online flag), incoming & outgoing requests
router.get('/', async (req, res) => {
  try {
    const data = await friendsStore.getFriendsData(req.user.userId);
    res.json({
      friends:  data.friends.map(f => ({ ...f, online: presence.isOnline(f.userId) })),
      incoming: data.incoming,
      outgoing: data.outgoing,
    });
  } catch (err) {
    console.error('[friends] list error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Send a friend request (or auto-accept if they already requested you)
router.post('/request', async (req, res) => {
  try {
    const result = await friendsStore.sendRequest(req.user.userId, req.user.username, req.body?.username);
    if (result.error) return res.status(400).json({ error: result.error });

    if (result.status === 'requested') {
      presence.emitToUser(result.addresseeId, 'friend_request_received', {
        id: result.requestId, userId: req.user.userId, username: req.user.username,
      });
    } else if (result.status === 'accepted') {
      presence.emitToUser(result.addresseeId, 'friend_request_accepted', {
        id: result.requestId, userId: req.user.userId, username: req.user.username,
      });
    }
    res.json({ status: result.status });
  } catch (err) {
    console.error('[friends] request error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Accept or decline an incoming request
router.post('/respond', async (req, res) => {
  const { id, action } = req.body || {};
  if (!id || !['accept', 'decline'].includes(action)) {
    return res.status(400).json({ error: 'id and a valid action are required' });
  }
  try {
    const result = await friendsStore.respondToRequest(req.user.userId, Number(id), action);
    if (result.error) return res.status(404).json({ error: result.error });

    if (result.status === 'accepted') {
      presence.emitToUser(result.otherUserId, 'friend_request_accepted', {
        id, userId: req.user.userId, username: req.user.username,
      });
    } else {
      presence.emitToUser(result.otherUserId, 'friend_request_declined', {
        id, userId: req.user.userId, username: req.user.username,
      });
    }
    res.json({ status: result.status });
  } catch (err) {
    console.error('[friends] respond error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Remove a friend or cancel an outgoing request
router.delete('/:id', async (req, res) => {
  try {
    const result = await friendsStore.removeRecord(req.user.userId, Number(req.params.id));
    if (result.error) return res.status(404).json({ error: result.error });

    presence.emitToUser(result.otherUserId, 'friend_removed', {
      userId: req.user.userId, username: req.user.username,
    });
    res.json({ status: 'removed' });
  } catch (err) {
    console.error('[friends] remove error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
