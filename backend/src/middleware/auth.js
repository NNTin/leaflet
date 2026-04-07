/**
 * Middleware factories for route-level authentication and authorization.
 */

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Authentication required.' });
}

function requirePrivileged(req, res, next) {
  if (req.isAuthenticated() && (req.user.role === 'privileged' || req.user.role === 'admin')) {
    return next();
  }
  res.status(403).json({ error: 'Privileged account required.' });
}

function requireAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user.role === 'admin') return next();
  res.status(403).json({ error: 'Admin access required.' });
}

module.exports = { requireAuth, requirePrivileged, requireAdmin };
