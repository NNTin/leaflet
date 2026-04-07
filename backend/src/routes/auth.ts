import express, { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import crypto from 'crypto';
import pool from '../db';
import { User } from '../models/user';

const router = express.Router();

router.get('/github', passport.authenticate('github', { scope: ['read:user'] }));

router.get(
  '/github/callback',
  passport.authenticate('github', { failureRedirect: `${process.env.FRONTEND_URL || 'http://localhost:5173'}?auth=failed` }),
  (req: Request, res: Response) => {
    res.redirect(process.env.FRONTEND_URL || 'http://localhost:5173');
  }
);

router.get('/me', (req: Request, res: Response) => {
  if (req.isAuthenticated()) {
    const { id, username, role, created_at } = req.user as User;
    return res.json({ id, username, role, created_at });
  }
  res.json(null);
});

router.post('/logout', (req: Request, res: Response, next: NextFunction) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy((destroyErr) => {
      if (destroyErr) return next(destroyErr);
      res.clearCookie('connect.sid');
      res.json({ message: 'Logged out successfully' });
    });
  });
});

router.get('/api-key', async (req: Request, res: Response, next: NextFunction) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Authentication required. Please log in via GitHub OAuth first.' });
  }
  try {
    const user = req.user as User;
    let { api_key } = user;
    if (!api_key) {
      api_key = crypto.randomBytes(32).toString('hex');
      await pool.query('UPDATE users SET api_key = $1 WHERE id = $2', [api_key, user.id]);
      (req.user as User).api_key = api_key;
    }
    res.json({ apiKey: api_key });
  } catch (err) {
    next(err);
  }
});

export default router;
