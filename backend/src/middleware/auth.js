/**
 * Middleware factories for route-level authentication and authorization.
 * Supports both session-based auth (GitHub OAuth) and API key auth (Bearer token).
 */

const pool = require('../db');

async function resolveApiKeyUser(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const apiKey = authHeader.slice(7).trim();
  if (!apiKey) return false;
  try {
    const result = await pool.query('SELECT * FROM users WHERE api_key = $1', [apiKey]);
    if (result.rows.length === 0) return false;
    req.user = result.rows[0];
    return true;
  } catch {
    return false;
  }
}

async function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  if (await resolveApiKeyUser(req)) return next();
  res.status(401).json({ error: 'Authentication required.' });
}

/**
 * Optional auth: if a Bearer token is present, resolve the API key user.
 * Does NOT block the request if unauthenticated – allows anonymous access.
 */
async function optionalApiKeyAuth(req, res, next) {
  if (!req.isAuthenticated()) {
    const authHeader = req.headers.authorization || '';
    if (authHeader.startsWith('Bearer ')) {
      await resolveApiKeyUser(req);
    }
  }
  next();
}

async function requirePrivileged(req, res, next) {
  if (req.isAuthenticated() || await resolveApiKeyUser(req)) {
    const role = req.user && req.user.role;
    if (role === 'privileged' || role === 'admin') return next();
    return res.status(403).json({ error: 'Privileged account required.' });
  }
  res.status(401).json({ error: 'Authentication required.' });
}

async function requireAdmin(req, res, next) {
  if (req.isAuthenticated() || await resolveApiKeyUser(req)) {
    if (req.user && req.user.role === 'admin') return next();
    return res.status(403).json({ error: 'Admin access required.' });
  }
  res.status(401).json({ error: 'Authentication required.' });
}

module.exports = { requireAuth, requirePrivileged, requireAdmin, optionalApiKeyAuth };
