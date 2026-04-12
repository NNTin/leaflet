import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import passport from 'passport';
import crypto from 'crypto';
import swaggerUi from 'swagger-ui-express';
import pool from './db';
import { User } from './models/user';
import { lookupAccessTokenWithUser } from './oauth/tokens';
import baseSpec from './openapi';
import {
  csrfBootstrapLimiter,
  authReadLimiter,
  authFlowLimiter,
  accountLimiter,
  shortenLimiter,
  openapiLimiter,
  adminProbeLimiter,
  oauthTokenLimiter,
  oauthAppsLimiter,
  oauthAuthorizeLimiter,
  composeLimiters,
  createRoleLimiter,
  POLICY,
} from './rate-limit';

import './passport';

import authRoutes from './routes/auth';
import urlRoutes, {
  redirectShortCode,
  humanRedirectShortCode,
  shortenValidators,
  createShortenHandler,
  createShortenCapabilitiesHandler,
} from './routes/urls';
import adminRoutes from './routes/admin';
import oauthRoutes from './routes/oauth';
import mergeRoutes from './routes/merge';
import { isAllowedFrontendOrigin, publicApiOrigin } from './config';
import { optionalBearerAuth } from './middleware/auth';

const CSRF_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const firstPartyCors = cors({
  origin(origin, callback) {
    callback(null, !origin || isAllowedFrontendOrigin(origin));
  },
  credentials: true,
});
const publicCors = cors({
  origin: true,
  credentials: false,
});

/**
 * OAuth machine-to-machine endpoints that must be exempt from CSRF.
 * These endpoints authenticate via client credentials, not browser sessions.
 * Apple's callback also uses form_post (no CSRF token header possible).
 */
const OAUTH_CSRF_EXEMPT_PATHS = new Set(['/oauth/token', '/oauth/revoke', '/auth/apple/callback']);

const app = express();

const trustProxy = process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : (process.env.NODE_ENV === 'test' ? 1 : 0);
app.set('trust proxy', trustProxy);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      // OAuth consent redirects to local loopback callback URLs for PKCE CLI login.
      formAction: ["'self'", 'http://127.0.0.1:*', 'http://localhost:*'],
    },
  },
}));

[
  '/auth/csrf-token',
  '/auth/me',
  '/auth/providers',
  '/auth/identities',
  '/auth/logout',
  '/auth/merge',
  '/api/shorten',
  '/api/urls',
  '/api/openapi.json',
  '/admin',
].forEach((path) => app.use(path, firstPartyCors));
app.use('/api/public', publicCors);

app.use(express.json());
// Required for OAuth /token, /revoke endpoints (form-encoded bodies)
// and the consent form submission.
app.use(express.urlencoded({ extended: false }));

interface SessionOptions extends session.SessionOptions {
  store?: session.Store;
}

const sessionOptions: SessionOptions = {
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
};

export const sessionStore: session.Store = (() => {
  if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const connectPgSimple = require('connect-pg-simple')(session);
    return new connectPgSimple({
      pool,
      tableName: 'session',
      createTableIfMissing: true,
    });
  }

  return new session.MemoryStore();
})();

sessionOptions.store = sessionStore;

app.use(session(sessionOptions));
app.use(passport.initialize());
app.use(passport.session());

// Early middleware: resolve OAuth Bearer tokens before CSRF check so that
// CSRF bypass and rate limit skip use a validated user, not raw headers.
async function earlyBearerAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  req.oauthAuthenticated = false;
  req.oauthTokenRejected = false;
  req.oauthClientId = undefined;
  req.oauthScopes = undefined;

  if (req.isAuthenticated()) return next();

  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) return next();

  const rawToken = authHeader.slice(7).trim();
  if (!rawToken) {
    req.oauthTokenRejected = true;
    return next();
  }

  try {
    const accessToken = await lookupAccessTokenWithUser(rawToken);
    if (!accessToken) {
      req.oauthTokenRejected = true;
      return next();
    }

    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [accessToken.userId]);
    if (userResult.rows.length === 0) {
      req.oauthTokenRejected = true;
      return next();
    }

    req.user = userResult.rows[0] as User;
    req.oauthAuthenticated = true;
    req.oauthClientId = accessToken.clientId;
    req.oauthScopes = accessToken.scopes;
  } catch (err) {
    next(err as Error);
    return;
  }

  next();
}

app.use(earlyBearerAuthMiddleware);

// Defined before any auth router — uses only the csrf-bootstrap bucket.
app.get('/auth/csrf-token', csrfBootstrapLimiter, (req: Request, res: Response) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.json({ csrfToken: req.session.csrfToken });
});

app.use((req: Request, res: Response, next: NextFunction) => {
  if (CSRF_SAFE_METHODS.has(req.method)) return next();

  if (req.path.startsWith('/api/public/')) return next();

  // OAuth token requests are not cookie-based so CSRF does not apply.
  if (req.oauthAuthenticated) return next();

  // OAuth machine-to-machine endpoints authenticate via client credentials.
  if (OAUTH_CSRF_EXEMPT_PATHS.has(req.path)) return next();

  // OAuth consent form POST: validate the CSRF token submitted as a hidden form
  // field (_csrf). The form is served from the backend origin (not a frontend
  // origin), so origin-based checks cannot be applied here.
  if (req.path === '/oauth/authorize/consent') {
    const sessionToken = req.session?.csrfToken;
    const bodyToken = typeof req.body?._csrf === 'string' ? (req.body._csrf as string) : undefined;
    if (
      sessionToken &&
      bodyToken &&
      sessionToken.length === bodyToken.length &&
      crypto.timingSafeEqual(Buffer.from(sessionToken), Buffer.from(bodyToken))
    ) {
      return next();
    }
    return res.status(403).json({ error: 'CSRF validation failed.' });
  }

  const requestOrigin = (() => {
    const rawOrigin = req.headers.origin ?? req.headers.referer ?? '';
    if (!rawOrigin) return undefined;
    try {
      return new URL(rawOrigin).origin;
    } catch {
      return null;
    }
  })();

  if (requestOrigin === null || (requestOrigin && !isAllowedFrontendOrigin(requestOrigin))) {
    return res.status(403).json({ error: 'CSRF validation failed.' });
  }

  // Programmatic requests (no Origin header) without an active session are not
  // subject to CSRF attacks: browsers always include an Origin header on cross-site
  // POST requests, so an absent Origin means the request is either same-site or
  // from a non-browser client (CLI, server). If there is no active session, CSRF
  // cannot be exploited — any endpoint that requires authentication will still
  // reject the request with 401 via requireAuth downstream.
  if (!requestOrigin && !req.isAuthenticated()) {
    return next();
  }

  const sessionToken = req.session?.csrfToken;
  const requestToken = req.headers['x-csrf-token'] as string | undefined;

  if (sessionToken && requestToken && sessionToken.length === requestToken.length && crypto.timingSafeEqual(
    Buffer.from(sessionToken),
    Buffer.from(requestToken)
  )) {
    return next();
  }

  res.status(403).json({ error: 'CSRF validation failed.' });
});

const { servers: _servers, ...baseSpecWithoutServers } = baseSpec;
const swaggerDocument = {
  ...baseSpecWithoutServers,
  servers: [
    {
      url: publicApiOrigin,
      description: 'Configured API server',
    },
  ],
};

// Per-route rate limiters (applied before routers, method-specific where needed).

// GET /auth/me, GET /auth/providers, GET /api/shorten/capabilities
app.get('/auth/me', authReadLimiter);
app.get('/auth/providers', authReadLimiter);
app.get('/api/shorten/capabilities', authReadLimiter);

function getOAuthUser(req: Request): User | null {
  return req.oauthAuthenticated === true ? (req.user as User | undefined) ?? null : null;
}

function getOAuthUserId(req: Request): string {
  const user = getOAuthUser(req);
  return user ? String(user.id) : (req.ip ?? '0.0.0.0');
}

function getOAuthUserRole(req: Request): User['role'] | null {
  return getOAuthUser(req)?.role ?? null;
}

const publicAuthReadLimiter = composeLimiters(
  createRoleLimiter(
    POLICY.AUTH_READ_ANONYMOUS,
    (req) => req.ip ?? '0.0.0.0',
    (req) => req.oauthAuthenticated === true,
  ),
  createRoleLimiter(
    POLICY.AUTH_READ_USER,
    getOAuthUserId,
    (req) => req.oauthAuthenticated !== true || getOAuthUserRole(req) !== 'user',
  ),
  createRoleLimiter(
    POLICY.AUTH_READ_PRIVILEGED,
    getOAuthUserId,
    (req) => req.oauthAuthenticated !== true || getOAuthUserRole(req) !== 'privileged',
  ),
);

const publicShortenLimiter = composeLimiters(
  createRoleLimiter(
    POLICY.SHORTEN_ANONYMOUS_IP,
    (req) => req.ip ?? '0.0.0.0',
    (req) => req.oauthAuthenticated === true,
  ),
  createRoleLimiter(
    POLICY.SHORTEN_USER,
    getOAuthUserId,
    (req) => req.oauthAuthenticated !== true || getOAuthUserRole(req) !== 'user',
  ),
  createRoleLimiter(
    POLICY.SHORTEN_PRIVILEGED,
    getOAuthUserId,
    (req) => req.oauthAuthenticated !== true || getOAuthUserRole(req) !== 'privileged',
  ),
);

const publicShortenCapabilitiesHandler = createShortenCapabilitiesHandler('public');
const publicShortenHandler = createShortenHandler('public');

// GET /auth/:provider, GET /auth/:provider/callback, POST /auth/apple/callback
// authFlowLimiter's skip function handles the exclusion of fixed paths (me, providers,
// identities) that are registered before this wildcard and have their own buckets.
app.get('/auth/:provider', authFlowLimiter);
app.get('/auth/:provider/callback', authFlowLimiter);
app.post('/auth/apple/callback', authFlowLimiter);

// GET /auth/:provider/link — authenticated only (anon has no bucket)
app.get('/auth/:provider/link', accountLimiter);

// Account-management routes (session-auth only, authenticated)
app.get('/auth/identities', accountLimiter);
app.delete('/auth/identities/:provider', accountLimiter);
app.post('/auth/logout', accountLimiter);
app.delete('/auth/me', accountLimiter);
app.post('/auth/merge/initiate', accountLimiter);
app.post('/auth/merge/confirm', accountLimiter);

// POST /api/shorten
app.post('/api/shorten', shortenLimiter);
app.get('/api/public/shorten/capabilities', publicAuthReadLimiter, optionalBearerAuth, publicShortenCapabilitiesHandler);
app.post('/api/public/shorten', publicShortenLimiter, optionalBearerAuth, ...shortenValidators, publicShortenHandler);

// GET /api/openapi.json
app.get('/api/openapi.json', openapiLimiter, (req: Request, res: Response) => res.json(swaggerDocument));

// Admin-only routes — non-admin callers hit the admin-probe bucket
app.get('/api/urls', adminProbeLimiter);
app.delete('/api/urls/:id', adminProbeLimiter);
app.get('/admin/urls', adminProbeLimiter);
app.delete('/admin/urls/:id', adminProbeLimiter);
app.get('/admin/users', adminProbeLimiter);
app.patch('/admin/users/:id/role', adminProbeLimiter);

// OAuth endpoints
app.get('/oauth/authorize', oauthAuthorizeLimiter);
app.post('/oauth/authorize/consent', oauthAuthorizeLimiter);
app.post('/oauth/token', oauthTokenLimiter);
app.post('/oauth/revoke', oauthTokenLimiter);
app.get('/oauth/apps', oauthAppsLimiter);
app.post('/oauth/apps', oauthAppsLimiter);
app.delete('/oauth/apps/:clientId', oauthAppsLimiter);

// Route handlers
app.use('/auth', authRoutes);
app.use('/auth/merge', mergeRoutes);
app.get('/s/:code', humanRedirectShortCode);
app.use('/api', urlRoutes);
app.use('/admin', adminRoutes);
app.use('/oauth', oauthRoutes);

if (process.env.E2E_TEST_MODE === 'true') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const e2eRoutes = require('./routes/e2e').default as express.Router;
  app.use('/e2e', e2eRoutes);
  console.warn('[E2E] Test-only /e2e routes are active — do not use in production.');
}

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
