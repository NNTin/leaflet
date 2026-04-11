import { Request, Response, NextFunction } from 'express';
import { User } from '../models/user';

function isAuthenticatedRequest(req: Request): boolean {
  return req.isAuthenticated() || req.oauthAuthenticated === true;
}

function isSessionAuthenticated(req: Request): boolean {
  return req.oauthAuthenticated !== true && req.isAuthenticated();
}

function respondUnauthorized(req: Request, res: Response): void {
  if (req.oauthTokenRejected) {
    res.status(401).json({ error: 'Invalid or expired bearer token.' });
    return;
  }

  res.status(401).json({ error: 'Authentication required.' });
}

function respondInsufficientScope(res: Response, scope: string): void {
  res.status(403).json({
    error: 'Insufficient scope.',
    requiredScope: scope,
    hint: `Re-authenticate requesting the '${scope}' scope.`,
  });
}

function oauthRequestHasScope(req: Request, scope: string): boolean {
  const scopes = req.oauthScopes ?? [];
  return scopes.includes('admin:*') || scopes.includes(scope);
}

export function ensureScopeForOAuthRequest(req: Request, res: Response, scope: string): boolean {
  if (!req.oauthAuthenticated) return true;
  if (oauthRequestHasScope(req, scope)) return true;

  respondInsufficientScope(res, scope);
  return false;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (isAuthenticatedRequest(req)) {
    next();
    return;
  }

  respondUnauthorized(req, res);
}

/**
 * Optional OAuth Bearer auth for endpoints that still allow anonymous access.
 * Invalid Bearer tokens are rejected with 401 rather than silently treated as anonymous.
 */
export async function optionalBearerAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.oauthTokenRejected) {
    respondUnauthorized(req, res);
    return;
  }

  next();
}

function requireRole(roles: Array<User['role']>, message: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!isAuthenticatedRequest(req)) {
      respondUnauthorized(req, res);
      return;
    }

    const role = (req.user as User | undefined)?.role;
    if (role && roles.includes(role)) {
      next();
      return;
    }

    res.status(403).json({ error: message });
  };
}

export const requirePrivileged = requireRole(
  ['privileged', 'admin'],
  'Privileged account required.',
);

export const requireAdmin = requireRole(
  ['admin'],
  'Admin access required.',
);

export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (isSessionAuthenticated(req)) {
      next();
      return;
    }

    if (req.oauthAuthenticated) {
      if (oauthRequestHasScope(req, scope)) {
        next();
        return;
      }

      respondInsufficientScope(res, scope);
      return;
    }

    respondUnauthorized(req, res);
  };
}
