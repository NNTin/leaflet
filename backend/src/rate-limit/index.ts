/**
 * Centralised rate-limit module.
 *
 * All bucket policy definitions live here.  Route files and app.ts import the
 * pre-composed middleware and apply them per-route.
 *
 * Header contract (IETF draft-8):
 *   - Every limited response emits  RateLimit  and  RateLimit-Policy .
 *   - 429 responses additionally emit  Retry-After .
 *   - Legacy  X-RateLimit-*  headers are never emitted.
 *   - When multiple buckets fire for one request (anonymous POST /api/shorten)
 *     the composed middleware merges their draft-8 entries into a single pair
 *     of structured-field headers.
 */

import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import pool from '../db';

// ---------------------------------------------------------------------------
// Bucket registry — single source of truth for all policy names and limits
// ---------------------------------------------------------------------------

export const POLICY = {
  CSRF_BOOTSTRAP_ANONYMOUS: 'csrf-bootstrap-anonymous',
  CSRF_BOOTSTRAP_USER: 'csrf-bootstrap-user',
  CSRF_BOOTSTRAP_PRIVILEGED: 'csrf-bootstrap-privileged',
  AUTH_READ_ANONYMOUS: 'auth-read-anonymous',
  AUTH_READ_USER: 'auth-read-user',
  AUTH_READ_PRIVILEGED: 'auth-read-privileged',
  AUTH_FLOW: 'auth-flow',
  ACCOUNT_USER: 'account-user',
  ACCOUNT_PRIVILEGED: 'account-privileged',
  SHORTEN_ANONYMOUS_SESSION: 'shorten-anonymous-session',
  SHORTEN_ANONYMOUS_IP: 'shorten-anonymous-ip',
  SHORTEN_USER: 'shorten-user',
  SHORTEN_PRIVILEGED: 'shorten-privileged',
  OPENAPI_ANONYMOUS: 'openapi-anonymous',
  OPENAPI_USER: 'openapi-user',
  OPENAPI_PRIVILEGED: 'openapi-privileged',
  ADMIN_PROBE: 'admin-probe',
  OAUTH_TOKEN: 'oauth-token',
  OAUTH_APPS_USER: 'oauth-apps-user',
  OAUTH_APPS_PRIVILEGED: 'oauth-apps-privileged',
} as const;

const BUCKET_CONFIGS: Record<string, { windowMs: number; max: number }> = {
  [POLICY.CSRF_BOOTSTRAP_ANONYMOUS]:  { windowMs: 5  * 60 * 1000, max: 30  },
  [POLICY.CSRF_BOOTSTRAP_USER]:       { windowMs: 5  * 60 * 1000, max: 60  },
  [POLICY.CSRF_BOOTSTRAP_PRIVILEGED]: { windowMs: 5  * 60 * 1000, max: 120 },
  [POLICY.AUTH_READ_ANONYMOUS]:       { windowMs: 1  * 60 * 1000, max: 120 },
  [POLICY.AUTH_READ_USER]:            { windowMs: 1  * 60 * 1000, max: 240 },
  [POLICY.AUTH_READ_PRIVILEGED]:      { windowMs: 1  * 60 * 1000, max: 480 },
  [POLICY.AUTH_FLOW]:                 { windowMs: 15 * 60 * 1000, max: 20  },
  [POLICY.ACCOUNT_USER]:              { windowMs: 15 * 60 * 1000, max: 60  },
  [POLICY.ACCOUNT_PRIVILEGED]:        { windowMs: 15 * 60 * 1000, max: 120 },
  [POLICY.SHORTEN_ANONYMOUS_SESSION]: { windowMs: 1  * 60 * 1000, max: 2   },
  [POLICY.SHORTEN_ANONYMOUS_IP]:      { windowMs: 5  * 60 * 1000, max: 20  },
  [POLICY.SHORTEN_USER]:              { windowMs: 15 * 60 * 1000, max: 60  },
  [POLICY.SHORTEN_PRIVILEGED]:        { windowMs: 15 * 60 * 1000, max: 180 },
  [POLICY.OPENAPI_ANONYMOUS]:         { windowMs: 5  * 60 * 1000, max: 60  },
  [POLICY.OPENAPI_USER]:              { windowMs: 5  * 60 * 1000, max: 120 },
  [POLICY.OPENAPI_PRIVILEGED]:        { windowMs: 5  * 60 * 1000, max: 240 },
  [POLICY.ADMIN_PROBE]:               { windowMs: 15 * 60 * 1000, max: 30  },
  [POLICY.OAUTH_TOKEN]:               { windowMs: 15 * 60 * 1000, max: 60  },
  [POLICY.OAUTH_APPS_USER]:           { windowMs: 15 * 60 * 1000, max: 60  },
  [POLICY.OAUTH_APPS_PRIVILEGED]:     { windowMs: 15 * 60 * 1000, max: 120 },
};

// ---------------------------------------------------------------------------
// Actor-role helpers
// ---------------------------------------------------------------------------

function isAuthenticatedUser(req: Request): boolean {
  return req.isAuthenticated() || req.oauthAuthenticated === true;
}

function getRole(req: Request): string | undefined {
  return (req.user as { role?: string } | undefined)?.role;
}

function isAdmin(req: Request): boolean {
  return getRole(req) === 'admin';
}

function isPrivileged(req: Request): boolean {
  return getRole(req) === 'privileged';
}

function isRegularUser(req: Request): boolean {
  if (!isAuthenticatedUser(req)) return false;
  const role = getRole(req);
  return role !== 'admin' && role !== 'privileged';
}

function userId(req: Request): string {
  return String((req.user as { id: number }).id);
}

// ---------------------------------------------------------------------------
// Core factory
// ---------------------------------------------------------------------------

/**
 * Creates a single express-rate-limit instance for the given policy name.
 * Uses IETF draft-8 headers (RateLimit / RateLimit-Policy) and no legacy
 * X-RateLimit-* headers.
 */
export function createRoleLimiter(
  policy: string,
  keyGenerator: (req: Request) => string | Promise<string>,
  skip: (req: Request) => boolean,
): RequestHandler {
  const cfg = BUCKET_CONFIGS[policy];
  if (!cfg) throw new Error(`Unknown rate-limit policy: ${policy}`);

  return rateLimit({
    windowMs: cfg.windowMs,
    max: cfg.max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    identifier: policy,
    keyGenerator,
    skip,
    message: { success: false, error: 'Rate limit exceeded.', hint: 'Please wait before retrying.' },
  });
}

// ---------------------------------------------------------------------------
// Header-merging composer
//
// Runs each limiter in sequence and combines their RateLimit /
// RateLimit-Policy structured-field entries into a single pair of headers.
// The combination is needed when multiple buckets fire on the same request
// (e.g. anonymous POST /api/shorten hits both a session bucket and an IP
// bucket simultaneously).
//
// Implementation note: express-rate-limit draft-8 emits headers via
// res.append → res.set → res.setHeader on the Node.js IncomingMessage.
// We temporarily patch res.setHeader and res.end to intercept the individual
// per-bucket values and commit a merged header pair before the first byte is
// written.  The casts below are intentional: we need to reassign inherited
// Node.js methods, which TypeScript's type system does not normally permit.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

/** Mutable view of the two response methods we temporarily override. */
interface MutableResponse extends Response {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setHeader: AnyFn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  end: AnyFn;
}

export function composeLimiters(...limiters: RequestHandler[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const rateLimitValues: string[] = [];
    const rateLimitPolicyValues: string[] = [];

    // Arguments captured from the first blocking limiter's res.end call.
    // When set, the final step will replay this call to send the 429 response.
    let blockedEndArgs: Parameters<Response['end']> | null = null;

    const mutableRes = res as MutableResponse;
    const origSetHeader: AnyFn = mutableRes.setHeader.bind(res);
    const origEnd: AnyFn = mutableRes.end.bind(res);

    let cleaned = false;

    function cleanup(): void {
      if (cleaned) return;
      cleaned = true;
      mutableRes.setHeader = origSetHeader;
      mutableRes.end = origEnd;
    }

    function commitHeaders(): void {
      if (rateLimitValues.length > 0) {
        origSetHeader('RateLimit', rateLimitValues.join(', '));
      }
      if (rateLimitPolicyValues.length > 0) {
        origSetHeader('RateLimit-Policy', rateLimitPolicyValues.join(', '));
      }
    }

    // Intercept setHeader to accumulate rate-limit header values rather than
    // letting each limiter overwrite the previous one's entry.
    mutableRes.setHeader = function interceptSetHeader(
      name: string,
      value: Parameters<Response['setHeader']>[1],
    ): Response {
      const lower = name.toLowerCase();
      if (lower === 'ratelimit') {
        rateLimitValues.push(String(value));
        return res;
      }
      if (lower === 'ratelimit-policy') {
        rateLimitPolicyValues.push(String(value));
        return res;
      }
      return origSetHeader(name, value) as Response;
    };

    // Intercept res.end so that when a limiter fires a 429, we capture the
    // response args and continue running the remaining limiters to collect
    // their RateLimit headers, rather than sending immediately.  Only after
    // all limiters have had a chance to run do we commit the combined headers
    // and replay the captured end() call.
    mutableRes.end = function interceptEnd(...args: Parameters<Response['end']>): Response {
      if (blockedEndArgs === null) {
        blockedEndArgs = args;
      }
      // Continue the chain instead of sending now.
      runNext();
      return res;
    };

    let idx = 0;

    function runNext(err?: unknown): void {
      if (err) {
        cleanup();
        next(err as Error);
        return;
      }

      if (idx >= limiters.length) {
        // All limiters have run.  Restore originals, commit merged headers,
        // then either send the captured 429 or call next().
        cleanup();
        commitHeaders();
        if (blockedEndArgs !== null) {
          origEnd(...blockedEndArgs);
        } else {
          next();
        }
        return;
      }

      const limiter = limiters[idx++];
      limiter(req, res, runNext);
    }

    runNext();
  };
}

// ---------------------------------------------------------------------------
// Pre-composed per-route limiters
// ---------------------------------------------------------------------------

// GET /auth/csrf-token
export const csrfBootstrapLimiter: RequestHandler = composeLimiters(
  createRoleLimiter(
    POLICY.CSRF_BOOTSTRAP_ANONYMOUS,
    (req) => req.ip ?? '0.0.0.0',
    (req) => isAuthenticatedUser(req),
  ),
  createRoleLimiter(
    POLICY.CSRF_BOOTSTRAP_USER,
    userId,
    (req) => !isRegularUser(req),
  ),
  createRoleLimiter(
    POLICY.CSRF_BOOTSTRAP_PRIVILEGED,
    userId,
    (req) => !isPrivileged(req) || isAdmin(req),
  ),
);

// GET /auth/me, GET /auth/providers
export const authReadLimiter: RequestHandler = composeLimiters(
  createRoleLimiter(
    POLICY.AUTH_READ_ANONYMOUS,
    (req) => req.ip ?? '0.0.0.0',
    (req) => isAuthenticatedUser(req),
  ),
  createRoleLimiter(
    POLICY.AUTH_READ_USER,
    userId,
    (req) => !isRegularUser(req),
  ),
  createRoleLimiter(
    POLICY.AUTH_READ_PRIVILEGED,
    userId,
    (req) => !isPrivileged(req) || isAdmin(req),
  ),
);

// GET /auth/:provider, GET /auth/:provider/callback, POST /auth/apple/callback
// GET /oauth/authorize (anonymous path)
//
// The skip function also excludes the fixed auth paths (me, providers, identities)
// that are registered before this wildcard route and have their own dedicated
// buckets.  This prevents the auth-flow bucket from double-firing on those paths
// when Express dispatches the wildcard handler after the specific one.
const AUTH_NON_PROVIDER_PATHS = new Set(['me', 'providers', 'identities']);
export const authFlowLimiter: RequestHandler = composeLimiters(
  createRoleLimiter(
    POLICY.AUTH_FLOW,
    (req) => req.ip ?? '0.0.0.0',
    (req) => {
      const provider = (req.params as Record<string, string | undefined>).provider;
      if (provider !== undefined && AUTH_NON_PROVIDER_PATHS.has(provider)) return true;
      return isAdmin(req) || process.env.E2E_TEST_MODE === 'true';
    },
  ),
);

// GET /auth/:provider/link, GET /auth/identities, DELETE /auth/identities/:provider,
// POST /auth/logout, DELETE /auth/me, POST /auth/merge/initiate, POST /auth/merge/confirm
// GET /oauth/authorize (authenticated path), POST /oauth/authorize/consent
export const accountLimiter: RequestHandler = composeLimiters(
  createRoleLimiter(
    POLICY.ACCOUNT_USER,
    userId,
    (req) => !isRegularUser(req),
  ),
  createRoleLimiter(
    POLICY.ACCOUNT_PRIVILEGED,
    userId,
    (req) => !isPrivileged(req) || isAdmin(req),
  ),
);

// POST /api/shorten
export const shortenLimiter: RequestHandler = composeLimiters(
  // Anonymous: both session and IP buckets must fire simultaneously.
  createRoleLimiter(
    POLICY.SHORTEN_ANONYMOUS_SESSION,
    (req) => (req.sessionID ? `anon-session:${req.sessionID}` : `anon-ip-fallback:${req.ip ?? '0.0.0.0'}`),
    (req) => isAuthenticatedUser(req),
  ),
  createRoleLimiter(
    POLICY.SHORTEN_ANONYMOUS_IP,
    (req) => req.ip ?? '0.0.0.0',
    (req) => isAuthenticatedUser(req),
  ),
  // Authenticated: role-appropriate user bucket (anonymous skipped via skip).
  createRoleLimiter(
    POLICY.SHORTEN_USER,
    userId,
    (req) => !isRegularUser(req),
  ),
  createRoleLimiter(
    POLICY.SHORTEN_PRIVILEGED,
    userId,
    (req) => !isPrivileged(req) || isAdmin(req),
  ),
);

// GET /api/openapi.json
export const openapiLimiter: RequestHandler = composeLimiters(
  createRoleLimiter(
    POLICY.OPENAPI_ANONYMOUS,
    (req) => req.ip ?? '0.0.0.0',
    (req) => isAuthenticatedUser(req),
  ),
  createRoleLimiter(
    POLICY.OPENAPI_USER,
    userId,
    (req) => !isRegularUser(req),
  ),
  createRoleLimiter(
    POLICY.OPENAPI_PRIVILEGED,
    userId,
    (req) => !isPrivileged(req) || isAdmin(req),
  ),
);

// GET /api/urls, DELETE /api/urls/:id, GET /admin/urls, DELETE /admin/urls/:id,
// GET /admin/users, PATCH /admin/users/:id/role
export const adminProbeLimiter: RequestHandler = composeLimiters(
  createRoleLimiter(
    POLICY.ADMIN_PROBE,
    (req) => req.ip ?? '0.0.0.0',
    (req) => isAdmin(req),
  ),
);

// POST /oauth/token, POST /oauth/revoke
export const oauthTokenLimiter: RequestHandler = composeLimiters(
  createRoleLimiter(
    POLICY.OAUTH_TOKEN,
    async (req) => {
      // Use a pre-validated Bearer-based client_id if available (set by earlyBearerAuthMiddleware).
      if (req.oauthClientId) {
        return `client:${req.oauthClientId}`;
      }

      // For body-based grants (authorization_code, client_credentials, etc.), the
      // client_id is passed in the request body for public clients.  Validate it
      // against the DB to prevent bucket-key rotation with fake client IDs.
      const rawClientId = typeof req.body?.client_id === 'string' ? (req.body.client_id as string) : undefined;
      if (rawClientId) {
        try {
          const result = await pool.query(
            'SELECT 1 FROM oauth_clients WHERE client_id = $1',
            [rawClientId],
          );
          if (result.rows.length > 0) {
            return `client:${rawClientId}`;
          }
        } catch (err) {
          // DB error during client validation — fall back to IP and log for diagnostics.
          console.error(
            `[rate-limit] oauthTokenLimiter: DB client_id validation failed for client="${rawClientId}" ip="${req.ip ?? 'unknown'}"`,
            err,
          );
        }
      }

      return req.ip ?? '0.0.0.0';
    },
    () => false,
  ),
);

// GET /oauth/apps, POST /oauth/apps, DELETE /oauth/apps/:clientId
export const oauthAppsLimiter: RequestHandler = composeLimiters(
  createRoleLimiter(
    POLICY.OAUTH_APPS_USER,
    userId,
    (req) => !isRegularUser(req),
  ),
  createRoleLimiter(
    POLICY.OAUTH_APPS_PRIVILEGED,
    userId,
    (req) => !isPrivileged(req) || isAdmin(req),
  ),
);

// GET /oauth/authorize, POST /oauth/authorize/consent — role-dispatched:
// anonymous → auth-flow, authenticated → account bucket, admin → skip
export const oauthAuthorizeLimiter: RequestHandler = composeLimiters(
  // Anonymous path uses auth-flow (IP-keyed, skipped for authenticated).
  createRoleLimiter(
    POLICY.AUTH_FLOW,
    (req) => req.ip ?? '0.0.0.0',
    (req) => isAuthenticatedUser(req) || process.env.E2E_TEST_MODE === 'true',
  ),
  // Authenticated non-admin users → account-user bucket.
  createRoleLimiter(
    POLICY.ACCOUNT_USER,
    userId,
    (req) => !isRegularUser(req),
  ),
  // Privileged → account-privileged bucket.
  createRoleLimiter(
    POLICY.ACCOUNT_PRIVILEGED,
    userId,
    (req) => !isPrivileged(req) || isAdmin(req),
  ),
);
