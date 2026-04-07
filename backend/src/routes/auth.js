const express = require('express');
const passport = require('passport');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../db');

// GET /auth/github - initiate GitHub OAuth flow
router.get('/github', passport.authenticate('github', { scope: ['read:user'] }));

// GET /auth/github/callback - OAuth callback
router.get(
  '/github/callback',
  passport.authenticate('github', { failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:5173'}?auth=failed` }),
  (req, res) => {
    res.redirect(process.env.FRONTEND_URL || 'http://localhost:5173');
  }
);

// GET /auth/me - return current user or null
router.get('/me', (req, res) => {
  if (req.isAuthenticated()) {
    const { id, username, role, created_at } = req.user;
    return res.json({ id, username, role, created_at });
  }
  res.json(null);
});

// POST /auth/logout - log out current session
router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy((destroyErr) => {
      if (destroyErr) return next(destroyErr);
      res.clearCookie('connect.sid');
      res.json({ message: 'Logged out successfully' });
    });
  });
});

// GET /auth/api-key - get (or generate) API key for the current user
// Used by CLI tools to obtain a stable token for programmatic access
router.get('/api-key', async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Authentication required. Please log in via GitHub OAuth first.' });
  }
  try {
    let { api_key } = req.user;
    if (!api_key) {
      api_key = crypto.randomBytes(32).toString('hex');
      await pool.query('UPDATE users SET api_key = $1 WHERE id = $2', [api_key, req.user.id]);
      req.user.api_key = api_key;
    }
    res.json({ apiKey: api_key });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
