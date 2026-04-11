import express, { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import { User } from '../models/user';
import { addAuthFailureParam, defaultFrontendUrl, resolveOAuthReturnTo } from '../config';
import { ensureScopeForOAuthRequest } from '../middleware/auth';

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
  if (req.oauthTokenRejected) {
    res.status(401).json({ error: 'Invalid or expired bearer token.' });
    return;
  }

  if (req.oauthAuthenticated) {
    if (!ensureScopeForOAuthRequest(req, res, 'user:read')) {
      return;
    }

    const { id, username, role, created_at } = req.user as User;
    res.json({ id, username, role, created_at, scopes: req.oauthScopes ?? [] });
    return;
  }

  if (req.isAuthenticated()) {
    const { id, username, role, created_at } = req.user as User;
    res.json({ id, username, role, created_at });
    return;
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

export default router;
