'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, memDb, memNextId } = require('../db/schema');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'kwerzo-dev-secret';

router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email and password are required' });
  }
  if (username.length < 2 || username.length > 32) {
    return res.status(400).json({ error: 'Username must be 2-32 characters' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);

    if (db.devMode) {
      const lname = username.trim().toLowerCase();
      const lemail = email.trim().toLowerCase();
      if (memDb.users.find(u => u.username.toLowerCase() === lname)) {
        return res.status(400).json({ error: 'Username already taken' });
      }
      if (memDb.users.find(u => u.email === lemail)) {
        return res.status(400).json({ error: 'Email already taken' });
      }
      const user = { id: memNextId(), username: username.trim(), email: lemail, password_hash: hash };
      memDb.users.push(user);
      const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
    }

    const result = await db.pool.query(
      'INSERT INTO kwerzo_users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email',
      [username.trim(), email.trim().toLowerCase(), hash]
    );
    const user = result.rows[0];
    await db.pool.query(
      'INSERT INTO kwerzo_leaderboard (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
      [user.id]
    );
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
  } catch (err) {
    if (err.code === '23505') {
      const field = err.constraint?.includes('email') ? 'Email' : 'Username';
      return res.status(400).json({ error: `${field} already taken` });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    if (db.devMode) {
      const user = memDb.users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());
      if (!user) return res.status(401).json({ error: 'Invalid username or password' });
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Invalid username or password' });
      const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
      return res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
    }

    const result = await db.pool.query(
      'SELECT id, username, email, password_hash FROM kwerzo_users WHERE LOWER(username) = LOWER($1)',
      [username.trim()]
    );
    const user = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid username or password' });
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
