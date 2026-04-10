import express, { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import crypto from 'crypto';
import pool from '../db';
import { User } from '../models/user';
import { addAuthFailureParam, defaultFrontendUrl, resolveOAuthReturnTo } from '../config';

const router = express.Router();

function consumeOAuthReturnTo(req: Request): string {
  const returnTo = req.session.oauthReturnTo ?? defaultFrontendUrl;
  delete req.session.oauthReturnTo;
  return returnTo;
}

router.get('/github', (req: Request, res: Response, next: NextFunction) => {
  const rawReturnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : undefined;
  req.session.oauthReturnTo = resolveOAuthReturnTo(rawReturnTo);

  req.session.save((err) => {
    if (err) return next(err);
    passport.authenticate('github', { scope: ['read:user'] })(req, res, next);
  });
});

router.get(
  '/github/callback',
  (req: Request, res: Response, next: NextFunction) => {
    const returnTo = consumeOAuthReturnTo(req);

    passport.authenticate('github', (err: Error | null, user?: Express.User | false) => {
      if (err) return next(err);

      if (!user) {
        res.redirect(addAuthFailureParam(returnTo));
        return;
      }

      req.logIn(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        res.redirect(returnTo);
      });
    })(req, res, next);
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
