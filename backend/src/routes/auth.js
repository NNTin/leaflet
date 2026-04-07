const express = require('express');
const passport = require('passport');
const router = express.Router();

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

module.exports = router;
