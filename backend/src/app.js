const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const session = require('express-session');
const passport = require('passport');
const rateLimit = require('express-rate-limit');
const YAML = require('yamljs');
const swaggerUi = require('swagger-ui-express');
const path = require('path');

require('./passport');

const authRoutes = require('./routes/auth');
const urlRoutes = require('./routes/urls');
const adminRoutes = require('./routes/admin');

// Rate limit constants
const ANON_SHORTEN_WINDOW_MS = 60 * 1000;       // 1 minute
const ANON_SHORTEN_MAX = 1;
const GLOBAL_API_WINDOW_MS = 15 * 60 * 1000;    // 15 minutes
const GLOBAL_API_MAX = 300;
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX = 30;
const ADMIN_WINDOW_MS = 60 * 1000;
const ADMIN_MAX = 60;

const app = express();

app.set('trust proxy', 1);

app.use(helmet());

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

app.use(
  cors({
    origin: frontendUrl,
    credentials: true,
  })
);

app.use(express.json());

// CSRF protection for state-mutating routes: verify Origin/Referer matches FRONTEND_URL
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

  const origin = req.headers.origin || req.headers.referer || '';
  if (origin.startsWith(frontendUrl)) return next();

  // Also allow requests originating from the same host (e.g. Swagger UI / direct API calls in dev)
  if (process.env.NODE_ENV !== 'production') return next();

  res.status(403).json({ error: 'CSRF check failed: invalid request origin.' });
});

const sessionOptions = {
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
};

if (process.env.NODE_ENV === 'production' && process.env.DATABASE_URL) {
  const pgSession = require('connect-pg-simple')(session);
  sessionOptions.store = new pgSession({
    conString: process.env.DATABASE_URL,
    tableName: 'session',
    createTableIfMissing: true,
  });
}

app.use(session(sessionOptions));
app.use(passport.initialize());
app.use(passport.session());

// Global rate limiter for all API and auth routes
const globalRateLimiter = rateLimit({
  windowMs: GLOBAL_API_WINDOW_MS,
  max: GLOBAL_API_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

// Anonymous rate limiter: 1 request/minute per IP, skipped for authenticated users
const anonymousRateLimiter = rateLimit({
  windowMs: ANON_SHORTEN_WINDOW_MS,
  max: ANON_SHORTEN_MAX,
  skip: (req) => req.isAuthenticated(),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please log in or wait before trying again.' },
});

// Auth route rate limiter
const authRateLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: AUTH_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication requests. Please try again later.' },
});

// Admin route rate limiter
const adminRateLimiter = rateLimit({
  windowMs: ADMIN_WINDOW_MS,
  max: ADMIN_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests. Please try again later.' },
});

app.use('/api', globalRateLimiter);
app.use('/api/shorten', anonymousRateLimiter);
app.use('/auth', authRateLimiter);
app.use('/admin', adminRateLimiter);

app.use('/auth', authRoutes);
app.use('/api', urlRoutes);
app.use('/admin', adminRoutes);

// OpenAPI / Swagger docs
try {
  const swaggerDocument = YAML.load(path.join(__dirname, 'openapi.yaml'));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
} catch (err) {
  console.warn('Could not load OpenAPI spec:', err.message);
}

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
