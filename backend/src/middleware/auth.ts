import { Request, Response, NextFunction } from 'express';
import pool from '../db';
import { User } from '../models/user';

async function resolveApiKeyUser(req: Request): Promise<boolean> {
  const authHeader = req.headers.authorization ?? '';
  if (!authHeader.startsWith('Bearer ')) return false;
  const apiKey = authHeader.slice(7).trim();
  if (!apiKey) return false;
  try {
    const result = await pool.query('SELECT * FROM users WHERE api_key = $1', [apiKey]);
    if (result.rows.length === 0) return false;
    req.user = result.rows[0] as User;
    req.apiKeyAuthenticated = true;
    return true;
  } catch {
    return false;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  // req.user may already be set by earlyApiKeyMiddleware (OAuth token or API key).
  if (req.isAuthenticated() || req.user) return next();
  // Fallback for code paths not running through earlyApiKeyMiddleware.
  if (await resolveApiKeyUser(req)) return next();
  res.status(401).json({ error: 'Authentication required.' });
}

/**
 * Optional auth: if a Bearer token is present, resolve the API key user.
 * Does NOT block the request if unauthenticated – allows anonymous access.
 */
export async function optionalApiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.isAuthenticated() && !req.user) {
    const authHeader = req.headers.authorization ?? '';
    if (authHeader.startsWith('Bearer ')) {
      await resolveApiKeyUser(req);
    }
  }
  next();
}

export async function requirePrivileged(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.isAuthenticated() && !req.user && !(await resolveApiKeyUser(req))) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  const role = (req.user as User | undefined)?.role;
  if (role === 'privileged' || role === 'admin') return next();
  res.status(403).json({ error: 'Privileged account required.' });
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.isAuthenticated() && !req.user && !(await resolveApiKeyUser(req))) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if ((req.user as User | undefined)?.role === 'admin') return next();
  res.status(403).json({ error: 'Admin access required.' });
}

/**
 * Enforces that an OAuth access token carries the specified scope.
 * Session-based and API-key-based requests bypass scope enforcement
 * so existing role-based access control is fully preserved.
 */
export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Session or legacy API key users: no additional scope restriction.
    if (req.isAuthenticated() || req.apiKeyAuthenticated) {
      return next();
    }

    // OAuth token: must include the required scope.
    if (req.oauthAuthenticated) {
      if ((req.oauthScopes ?? []).includes(scope)) return next();
      res.status(403).json({
        error: 'Insufficient scope.',
        hint: `Re-authenticate requesting the '${scope}' scope.`,
      });
      return;
    }

    // Not authenticated at all.
    res.status(401).json({ error: 'Authentication required.' });
  };
}
