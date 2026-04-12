import express, { Request, Response, NextFunction } from 'express';
import passport from 'passport';
import pool from '../db';
import { User } from '../models/user';
import { ProviderName, listIdentitiesForUser, deleteIdentity, countIdentitiesForUser } from '../models/identity';
import { addAuthFailureParam, defaultFrontendUrl, resolveOAuthReturnTo } from '../config';
import { ensureScopeForOAuthRequest, requireAuth } from '../middleware/auth';
import { isProviderRegistered, listRegisteredProviders } from '../providers/registry';

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function consumeOAuthReturnTo(req: Request): string {
  const returnTo = req.session.oauthReturnTo ?? defaultFrontendUrl;
  delete req.session.oauthReturnTo;
  return returnTo;
}

const VALID_PROVIDERS: ProviderName[] = ['github', 'google', 'discord', 'microsoft', 'apple'];

/** Human-readable labels for each known provider. */
const PROVIDER_LABELS: Record<ProviderName, string> = {
  github: 'GitHub',
  google: 'Google',
  discord: 'Discord',
  microsoft: 'Microsoft',
  apple: 'Apple',
};

function isValidProvider(value: string): value is ProviderName {
  return (VALID_PROVIDERS as string[]).includes(value);
}

function getAuthOptions(provider: ProviderName): object {
  if (provider === 'apple') {
    return { responseType: 'code', responseMode: 'form_post' };
  }
  return {};
}

// ---------------------------------------------------------------------------
// NOTE: Specific routes MUST be registered before wildcard /:provider routes.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GET /auth/providers  –  List currently configured OAuth providers
// ---------------------------------------------------------------------------

router.get('/providers', (_req: Request, res: Response) => {
  const providers = listRegisteredProviders().map((name) => ({
    name,
    label: PROVIDER_LABELS[name],
  }));
  res.json(providers);
});

// ---------------------------------------------------------------------------
// GET /auth/me
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// GET /auth/identities  –  List connected providers for the current user
// ---------------------------------------------------------------------------

router.get('/identities', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user as User;
    const identities = await listIdentitiesForUser(user.id);

    res.json(
      identities.map(({ id, provider, display_name, email, email_verified, created_at }) => ({
        id,
        provider,
        displayName: display_name,
        email,
        emailVerified: email_verified,
        connectedAt: created_at,
      })),
    );
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /auth/identities/:provider  –  Disconnect a provider
// ---------------------------------------------------------------------------

router.delete('/identities/:provider', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const provider = String(req.params.provider);

  if (!isValidProvider(provider)) {
    res.status(400).json({ success: false, error: 'Unknown provider.', hint: `Valid providers: ${VALID_PROVIDERS.join(', ')}.` });
    return;
  }

  try {
    const user = req.user as User;
    const count = await countIdentitiesForUser(user.id);

    if (count <= 1) {
      res.status(400).json({
        success: false,
        error: 'Cannot disconnect your only login method.',
        hint: 'Connect another provider before disconnecting this one.',
      });
      return;
    }

    const deleted = await deleteIdentity(user.id, provider);
    if (!deleted) {
      res.status(404).json({
        success: false,
        error: `No ${provider} identity found for your account.`,
      });
      return;
    }

    res.json({ success: true, message: `${provider} disconnected successfully.` });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/logout
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// DELETE /auth/me  –  Delete the authenticated user's account (session auth only)
// ---------------------------------------------------------------------------

router.delete('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  // OAuth bearer tokens must not be able to delete an account — this is a
  // browser-session-only destructive action. The CSRF middleware already
  // skips CSRF for OAuth requests, so an additional check here is required.
  if (req.oauthAuthenticated) {
    res.status(403).json({
      success: false,
      error: 'Account deletion requires a browser session.',
      hint: 'Log in via a browser session to delete your account.',
    });
    return;
  }

  try {
    const user = req.user as User;

    // Delete the user row; ON DELETE CASCADE / SET NULL handles child rows.
    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);

    // Destroy the session and clear the cookie so the client is logged out.
    req.logout((logoutErr) => {
      if (logoutErr) {
        next(logoutErr);
        return;
      }
      req.session.destroy((destroyErr) => {
        if (destroyErr) {
          next(destroyErr);
          return;
        }
        res.clearCookie('connect.sid');
        res.json({ success: true, message: 'Account deleted successfully.' });
      });
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/apple/callback  –  Apple uses form_post response mode.
// Must be registered before the generic /:provider/callback GET route.
// ---------------------------------------------------------------------------

router.post(
  '/apple/callback',
  (req: Request, res: Response, next: NextFunction) => {
    if (!isProviderRegistered('apple')) {
      res.status(503).json({
        success: false,
        error: 'Apple provider is not configured.',
        hint: 'Configure the Apple OAuth credentials and retry the request.',
      });
      return;
    }

    const returnTo = consumeOAuthReturnTo(req);

    passport.authenticate('apple', (err: Error | null, user?: Express.User | false) => {
      if (err) return next(err);

      if (!user) {
        res.redirect(addAuthFailureParam(returnTo));
        return;
      }

      if (req.session.linkConflict) {
        const conflictUrl = new URL(returnTo);
        conflictUrl.searchParams.set('auth', 'link_conflict');
        conflictUrl.searchParams.set('provider', req.session.linkConflict.provider);
        conflictUrl.searchParams.set('conflictingUserId', String(req.session.linkConflict.conflictingUserId));
        res.redirect(conflictUrl.toString());
        return;
      }

      if (req.isAuthenticated()) {
        res.redirect(returnTo);
        return;
      }

      req.logIn(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        res.redirect(returnTo);
      });
    })(req, res, next);
  },
);

// ---------------------------------------------------------------------------
// GET /auth/:provider  –  Initiate login (wildcard — keep after specific routes)
// ---------------------------------------------------------------------------

router.get('/:provider', (req: Request, res: Response, next: NextFunction) => {
  const provider = String(req.params.provider);

  if (!isValidProvider(provider)) {
    res.status(400).json({ success: false, error: 'Unknown provider.', hint: `Valid providers: ${VALID_PROVIDERS.join(', ')}.` });
    return;
  }

  if (!isProviderRegistered(provider)) {
    res.status(503).json({ success: false, error: `${provider} login is not configured on this server.`, hint: 'Contact the administrator.' });
    return;
  }

  const rawReturnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : undefined;
  req.session.oauthReturnTo = resolveOAuthReturnTo(rawReturnTo);
  delete req.session.linkConflict;

  req.session.save((err) => {
    if (err) return next(err);
    passport.authenticate(provider, getAuthOptions(provider))(req, res, next);
  });
});

// ---------------------------------------------------------------------------
// GET /auth/:provider/link  –  Initiate account linking (requires auth)
// ---------------------------------------------------------------------------

router.get('/:provider/link', requireAuth, (req: Request, res: Response, next: NextFunction) => {
  const provider = String(req.params.provider);

  if (!isValidProvider(provider)) {
    res.status(400).json({ success: false, error: 'Unknown provider.', hint: `Valid providers: ${VALID_PROVIDERS.join(', ')}.` });
    return;
  }

  if (!isProviderRegistered(provider)) {
    res.status(503).json({ success: false, error: `${provider} is not configured on this server.`, hint: 'Contact the administrator.' });
    return;
  }

  const rawReturnTo = typeof req.query.returnTo === 'string' ? req.query.returnTo : undefined;
  req.session.oauthReturnTo = resolveOAuthReturnTo(rawReturnTo);

  req.session.save((err) => {
    if (err) return next(err);
    passport.authenticate(provider, getAuthOptions(provider))(req, res, next);
  });
});

// ---------------------------------------------------------------------------
// GET /auth/:provider/callback  –  OAuth callback for all GET-based providers
// ---------------------------------------------------------------------------

router.get(
  '/:provider/callback',
  (req: Request, res: Response, next: NextFunction) => {
    const provider = String(req.params.provider);

    // Apple uses form_post response mode — its callback must be POST.
    if (provider === 'apple') {
      res.status(405).json({
        success: false,
        error: 'Apple Sign In callbacks must use POST /auth/apple/callback.',
        hint: 'Apple Sign In uses form_post response mode; the callback is a POST request, not a GET.',
      });
      return;
    }

    if (!isValidProvider(provider)) {
      res.status(400).json({
        success: false,
        error: 'Unknown provider.',
        hint: `Valid providers: ${VALID_PROVIDERS.join(', ')}.`,
      });
      return;
    }

    if (!isProviderRegistered(provider)) {
      res.status(503).json({
        success: false,
        error: `${provider} authentication is not configured on this server.`,
        hint: 'Contact the administrator.',
      });
      return;
    }

    const returnTo = consumeOAuthReturnTo(req);

    passport.authenticate(provider, (err: Error | null, user?: Express.User | false) => {
      if (err) return next(err);

      if (!user) {
        res.redirect(addAuthFailureParam(returnTo));
        return;
      }

      if (req.session.linkConflict) {
        const conflictUrl = new URL(returnTo);
        conflictUrl.searchParams.set('auth', 'link_conflict');
        conflictUrl.searchParams.set('provider', req.session.linkConflict.provider);
        conflictUrl.searchParams.set('conflictingUserId', String(req.session.linkConflict.conflictingUserId));
        res.redirect(conflictUrl.toString());
        return;
      }

      if (req.isAuthenticated()) {
        res.redirect(returnTo);
        return;
      }

      req.logIn(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        res.redirect(returnTo);
      });
    })(req, res, next);
  },
);

export default router;
