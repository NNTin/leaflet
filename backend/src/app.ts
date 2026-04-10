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

import './passport';

import authRoutes from './routes/auth';
import urlRoutes, { redirectShortCode } from './routes/urls';
import adminRoutes from './routes/admin';
import { isAllowedFrontendOrigin, publicApiOrigin } from './config';

const ANON_SHORTEN_WINDOW_MS = 60 * 1000;
const ANON_SHORTEN_MAX = 1;
const GLOBAL_API_WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_API_MAX = 300;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX = 30;
const ADMIN_WINDOW_MS = 60 * 1000;
const ADMIN_MAX = 60;

const CSRF_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

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

if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const connectPgSimple = require('connect-pg-simple')(session);
  sessionOptions.store = new connectPgSimple({
    conString: process.env.DATABASE_URL,
    tableName: 'session',
    createTableIfMissing: true,
  });
}

app.use(session(sessionOptions));
app.use(passport.initialize());
app.use(passport.session());

// Global rate limiter applied to all routes — runs before any auth or DB lookups
// to prevent abuse of middleware-level database queries (e.g. API key lookup).
const globalRateLimiter = rateLimit({
  windowMs: GLOBAL_API_WINDOW_MS,
  max: GLOBAL_API_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

app.use(globalRateLimiter);

// Early middleware: resolve API key user before CSRF check so that
// CSRF bypass and rate limit skip use a validated user, not raw headers.
// The global rate limiter above ensures this DB lookup is rate-limited.
async function earlyApiKeyMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  req.apiKeyAuthenticated = false;
  if (req.isAuthenticated()) return next();
  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) return next();
  const apiKey = authHeader.slice(7).trim();
  if (!apiKey) return next();
  try {
    const result = await pool.query('SELECT * FROM users WHERE api_key = $1', [apiKey]);
    if (result.rows.length > 0) {
      req.user = result.rows[0] as User;
      req.apiKeyAuthenticated = true;
    }
  } catch {
    // Treat as unauthenticated
  }
  next();
}

app.use(earlyApiKeyMiddleware);

app.get('/auth/csrf-token', (req: Request, res: Response) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.json({ csrfToken: req.session.csrfToken });
});

app.use((req: Request, res: Response, next: NextFunction) => {
  if (CSRF_SAFE_METHODS.has(req.method)) return next();

  // API key (Bearer token) requests are not cookie-based so CSRF does not apply.
  // req.user is set by earlyApiKeyMiddleware, ensuring the token was validated.
  if (req.apiKeyAuthenticated) return next();

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

// Anonymous rate limiter: skip for session-auth or validated API key users
const anonymousRateLimiter = rateLimit({
  windowMs: ANON_SHORTEN_WINDOW_MS,
  max: ANON_SHORTEN_MAX,
  skip: (req: Request) => req.isAuthenticated() || !!req.user,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please log in or wait before trying again.' },
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

app.use('/api/shorten', anonymousRateLimiter);
app.use('/auth', authRateLimiter);
app.use('/admin', adminRateLimiter);

app.use('/auth', authRoutes);
app.get('/s/:code', redirectShortCode);
app.use('/api', urlRoutes);
app.use('/admin', adminRoutes);

if (swaggerDocument) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
