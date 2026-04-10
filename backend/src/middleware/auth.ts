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
  if (req.isAuthenticated()) return next();
  if (await resolveApiKeyUser(req)) return next();
  res.status(401).json({ error: 'Authentication required.' });
}

/**
 * Optional auth: if a Bearer token is present, resolve the API key user.
 * Does NOT block the request if unauthenticated – allows anonymous access.
 */
export async function optionalApiKeyAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.isAuthenticated()) {
    const authHeader = req.headers.authorization ?? '';
    if (authHeader.startsWith('Bearer ')) {
      await resolveApiKeyUser(req);
    }
  }
  next();
}

export async function requirePrivileged(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.isAuthenticated() || await resolveApiKeyUser(req)) {
    const role = req.user && (req.user as User).role;
    if (role === 'privileged' || role === 'admin') return next();
    res.status(403).json({ error: 'Privileged account required.' });
    return;
  }
  res.status(401).json({ error: 'Authentication required.' });
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.isAuthenticated() || await resolveApiKeyUser(req)) {
    if (req.user && (req.user as User).role === 'admin') return next();
    res.status(403).json({ error: 'Admin access required.' });
    return;
  }
  res.status(401).json({ error: 'Authentication required.' });
}
