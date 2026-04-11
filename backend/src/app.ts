import express, { Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import passport from 'passport';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import YAML from 'yamljs';
import swaggerUi from 'swagger-ui-express';
import path from 'path';
import pool from './db';
import { User } from './models/user';
import { lookupAccessTokenWithUser } from './oauth/tokens';

import './passport';

import authRoutes from './routes/auth';
import urlRoutes, { redirectShortCode } from './routes/urls';
import adminRoutes from './routes/admin';
import oauthRoutes from './routes/oauth';
import { isAllowedFrontendOrigin, publicApiOrigin } from './config';

const ANON_SESSION_WINDOW_MS = 60 * 1000;
const ANON_SESSION_MAX = 1;
const ANON_IP_GUARD_WINDOW_MS = 60 * 1000;
const ANON_IP_GUARD_MAX = 10;
const GLOBAL_API_WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_API_MAX = 300;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX = 30;
const ADMIN_WINDOW_MS = 60 * 1000;
const ADMIN_MAX = 60;

const CSRF_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * OAuth machine-to-machine endpoints that must be exempt from CSRF.
 * These endpoints authenticate via client credentials, not browser sessions.
 */
const OAUTH_CSRF_EXEMPT_PATHS = new Set(['/oauth/token', '/oauth/revoke']);

const app = express();

const trustProxy = process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : (process.env.NODE_ENV === 'test' ? 1 : 0);
app.set('trust proxy', trustProxy);
app.use(helmet());

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    callback(null, !origin || isAllowedFrontendOrigin(origin));
  },
  credentials: true,
};

app.use(cors(corsOptions));

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

// Global rate limiter applied to all routes — runs before any auth or DB lookups.
const globalRateLimiter = rateLimit({
  windowMs: GLOBAL_API_WINDOW_MS,
  max: GLOBAL_API_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

app.use(globalRateLimiter);

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

app.get('/auth/csrf-token', (req: Request, res: Response) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.json({ csrfToken: req.session.csrfToken });
});

app.use((req: Request, res: Response, next: NextFunction) => {
  if (CSRF_SAFE_METHODS.has(req.method)) return next();

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

// Anonymous per-session limiter: each anonymous browser session gets its own bucket.
const anonymousSessionRateLimiter = rateLimit({
  windowMs: ANON_SESSION_WINDOW_MS,
  max: ANON_SESSION_MAX,
  skip: (req: Request) => req.isAuthenticated() || !!req.user,
  keyGenerator: (req: Request) => {
    if (req.sessionID) {
      return `anon-session:${req.sessionID}`;
    }

    // Fallback in case a session id is unavailable.
    return `anon-ip-fallback:${req.ip}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please log in or wait before trying again.' },
});

// Anonymous IP guardrail: caps aggregate anonymous traffic per source IP.
const anonymousIpGuardRateLimiter = rateLimit({
  windowMs: ANON_IP_GUARD_WINDOW_MS,
  max: ANON_IP_GUARD_MAX,
  skip: (req: Request) => req.isAuthenticated() || !!req.user,
  keyGenerator: (req: Request) => `anon-ip:${req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many anonymous requests from this IP. Please log in or wait before trying again.' },
});

const authRateLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication requests. Please try again later.' },
});

const adminRateLimiter = rateLimit({
  windowMs: ADMIN_WINDOW_MS,
  max: ADMIN_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests. Please try again later.' },
});

let swaggerDocument: Record<string, unknown> | undefined;
try {
  swaggerDocument = YAML.load(path.join(__dirname, 'openapi.yaml')) as Record<string, unknown>;
} catch (err) {
  console.warn('Could not load OpenAPI spec:', (err as Error).message);
}

if (swaggerDocument) {
  swaggerDocument = {
    ...swaggerDocument,
    servers: [
      {
        url: publicApiOrigin,
        description: 'Configured API server',
      },
    ],
  };
  app.get('/api/openapi.json', (req: Request, res: Response) => res.json(swaggerDocument));
}

app.use('/api/shorten', anonymousSessionRateLimiter);
app.use('/api/shorten', anonymousIpGuardRateLimiter);
app.use('/auth', authRateLimiter);
app.use('/admin', adminRateLimiter);

app.use('/auth', authRoutes);
app.get('/s/:code', redirectShortCode);
app.use('/api', urlRoutes);
app.use('/admin', adminRoutes);
app.use('/oauth', oauthRoutes);

if (swaggerDocument) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
