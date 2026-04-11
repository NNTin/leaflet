import crypto from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import { body, query as qv, validationResult } from 'express-validator';
import pool from '../db';
import { User } from '../models/user';
import { findClient, isValidRedirectUri, createClient, verifyClientSecret } from '../oauth/clients';
import { issueAuthorizationCode, consumeAuthorizationCode } from '../oauth/codes';
import { issueTokenPair, rotateRefreshToken, revokeAccessToken, revokeRefreshToken } from '../oauth/tokens';
import { verifyPkce } from '../oauth/pkce';
import { parseScopes, isValidScope, userRoleSatisfiesScope, VALID_SCOPES } from '../oauth/scopes';
import { requireAuth, requireScope } from '../middleware/auth';

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function oauthError(
  res: Response,
  status: number,
  error: string,
  description: string,
): void {
  res.status(status).json({ error, error_description: description });
}

function buildRedirectWithError(
  redirectUri: string,
  error: string,
  state: string | undefined,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

function renderConsentPage(params: {
  clientName: string;
  username: string;
  scopes: string[];
  csrfToken: string;
}): string {
  const scopeDescriptions: Record<string, string> = {
    'shorten:create': 'Create short links',
    'shorten:create:never': 'Create permanent links (no expiration)',
    'shorten:create:alias': 'Create links with custom aliases',
    'urls:read': 'List all short links (admin)',
    'urls:delete': 'Delete any short link (admin)',
    'users:read': 'List all users (admin)',
    'users:write': 'Change user roles (admin)',
    'user:read': 'Read your profile',
    'oauth:apps:read': 'Read your OAuth application consents',
    'oauth:apps:write': 'Create or revoke your OAuth applications',
    'admin:*': 'Full admin access',
  };

  const scopeItems = params.scopes
    .map(
      (s) =>
        `<li><code>${escapeHtml(s)}</code>${scopeDescriptions[s] ? ` — ${escapeHtml(scopeDescriptions[s])}` : ''}</li>`,
    )
    .join('\n        ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize ${escapeHtml(params.clientName)} — Leaflet</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #f5f5f5;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
    }
    .card {
      background: #fff;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,.12);
      max-width: 440px;
      width: 100%;
      padding: 2rem;
    }
    h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
    p  { color: #555; font-size: .9rem; margin: .5rem 0; }
    ul { padding-left: 1.25rem; color: #333; font-size: .9rem; }
    li { margin: .35rem 0; }
    code { background: #f0f0f0; border-radius: 4px; padding: 1px 5px; font-size: .85em; }
    .actions { display: flex; gap: .75rem; margin-top: 1.5rem; }
    button {
      flex: 1;
      padding: .6rem 1rem;
      border: none;
      border-radius: 6px;
      font-size: .95rem;
      cursor: pointer;
    }
    .approve { background: #2563eb; color: #fff; }
    .approve:hover { background: #1d4ed8; }
    .deny   { background: #f5f5f5; color: #333; border: 1px solid #ddd; }
    .deny:hover { background: #e5e5e5; }
    .user-info { font-size: .8rem; color: #888; margin-bottom: 1rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Authorize <strong>${escapeHtml(params.clientName)}</strong></h1>
    <p class="user-info">Signed in as <strong>${escapeHtml(params.username)}</strong></p>
    <p>This application is requesting access to your Leaflet account with the following permissions:</p>
    <ul>
        ${scopeItems}
    </ul>
    <form method="post" action="/oauth/authorize/consent">
      <input type="hidden" name="_csrf" value="${escapeHtml(params.csrfToken)}">
      <div class="actions">
        <button type="submit" name="approved" value="true"  class="approve">Approve</button>
        <button type="submit" name="approved" value="false" class="deny">Deny</button>
      </div>
    </form>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Validates a redirect URI for client registration.
 * Rules (per RFC 6749 §3.1.2 and RFC 8252 §7.3):
 *  - Must be a well-formed absolute URL (no fragment)
 *  - http scheme is only allowed for loopback addresses
 *  - https is required for all non-loopback redirect URIs
 */
function validateRedirectUri(uri: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return `"${uri}" is not a valid URL`;
  }

  if (parsed.hash) {
    return `Redirect URI must not contain a fragment: ${uri}`;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return `Redirect URI must use http or https scheme: ${uri}`;
  }

  const isLoopback =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '[::1]';

  if (parsed.protocol === 'http:' && !isLoopback) {
    return `Non-loopback redirect URIs must use https: ${uri}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// GET /oauth/authorize
// ---------------------------------------------------------------------------

router.get(
  '/authorize',
  [
    qv('response_type').equals('code').withMessage('response_type must be "code"'),
    qv('client_id').notEmpty().withMessage('client_id is required'),
    qv('redirect_uri').notEmpty().withMessage('redirect_uri is required'),
    qv('scope').notEmpty().withMessage('scope is required'),
  ],
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      const {
        client_id: clientId,
        redirect_uri: redirectUri,
        scope,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
      } = req.query as Record<string, string | undefined>;

      // If basic validation fails and we have no redirect_uri, return JSON error.
      if (errors.isEmpty() === false) {
        if (!redirectUri) {
          res.status(400).json({ error: 'invalid_request', error_description: errors.array()[0].msg });
          return;
        }
      }

      // Resolve client (safe to do even if redirect_uri missing, for better error msg)
      const client = clientId ? await findClient(clientId) : null;
      if (!client) {
        res.status(400).json({ error: 'invalid_client', error_description: 'Unknown or revoked client.' });
        return;
      }

      if (!redirectUri || !isValidRedirectUri(client, redirectUri)) {
        res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri is invalid or not registered.' });
        return;
      }

      // From here we can redirect errors to redirectUri.
      if (!errors.isEmpty()) {
        res.redirect(buildRedirectWithError(redirectUri, 'invalid_request', state));
        return;
      }

      // PKCE required for public clients.
      if (client.is_public && !codeChallenge) {
        res.redirect(buildRedirectWithError(redirectUri, 'invalid_request', state));
        return;
      }

      if (codeChallengeMethod && codeChallengeMethod !== 'S256') {
        res.redirect(buildRedirectWithError(redirectUri, 'invalid_request', state));
        return;
      }

      // Parse and validate scopes; any unrecognised scope is rejected.
      let requestedScopes: ReturnType<typeof parseScopes>;
      try {
        requestedScopes = parseScopes(scope ?? '');
      } catch {
        res.redirect(buildRedirectWithError(redirectUri, 'invalid_scope', state));
        return;
      }
      if (requestedScopes.length === 0) {
        res.redirect(buildRedirectWithError(redirectUri, 'invalid_scope', state));
        return;
      }

      // Scopes must be a subset of what the client is allowed to request.
      const invalidScope = requestedScopes.find((s) => !client.scopes.includes(s));
      if (invalidScope) {
        res.redirect(buildRedirectWithError(redirectUri, 'invalid_scope', state));
        return;
      }

      // Require the user to be logged in via session.
      if (!req.isAuthenticated()) {
        const returnTo = req.url;
        req.session.oauthReturnTo = returnTo;
        req.session.save((err) => {
          if (err) return next(err);
          res.redirect(`/auth/github?returnTo=${encodeURIComponent(returnTo)}`);
        });
        return;
      }

      const user = req.user as User;

      // Filter scopes to only those the user's role can grant.
      const grantableScopes = requestedScopes.filter((s) =>
        userRoleSatisfiesScope(user.role, s),
      );

      if (grantableScopes.length === 0) {
        res.redirect(buildRedirectWithError(redirectUri, 'access_denied', state));
        return;
      }

      // Generate CSRF token for the consent form if not already present.
      if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      }

      // Store pending auth parameters in session (single-use, consumed by POST).
      req.session.pendingOAuth = {
        clientId: client.client_id,
        redirectUri,
        scopes: grantableScopes,
        state,
        codeChallenge: codeChallenge ?? null,
        codeChallengeMethod: codeChallengeMethod ?? 'S256',
      };

      req.session.save((err) => {
        if (err) return next(err);
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(
          renderConsentPage({
            clientName: client.name,
            username: user.username,
            scopes: grantableScopes,
            csrfToken: req.session.csrfToken as string,
          }),
        );
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /oauth/authorize/consent  (HTML form submission)
// ---------------------------------------------------------------------------

router.post(
  '/authorize/consent',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // User must be authenticated.
      if (!req.isAuthenticated()) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }

      const pending = req.session.pendingOAuth;
      if (!pending) {
        res.status(400).json({ error: 'No pending authorization request.' });
        return;
      }

      // Consume the pending state (single-use).
      delete req.session.pendingOAuth;

      const { redirectUri, state } = pending;

      const approved = req.body?.approved === 'true';

      if (!approved) {
        req.session.save(() => {
          res.redirect(buildRedirectWithError(redirectUri, 'access_denied', state));
        });
        return;
      }

      const user = req.user as User;

      // Issue authorization code.
      const code = await issueAuthorizationCode({
        clientId: pending.clientId,
        userId: user.id,
        redirectUri,
        scopes: pending.scopes,
        codeChallenge: pending.codeChallenge ?? undefined,
        codeChallengeMethod: pending.codeChallengeMethod,
      });

      // Store/update consent record.
      await pool.query(
        `INSERT INTO oauth_consents (user_id, client_id, scopes)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, client_id)
         DO UPDATE SET scopes = EXCLUDED.scopes, revoked_at = NULL, granted_at = NOW()`,
        [user.id, pending.clientId, pending.scopes],
      );

      const redirectUrl = new URL(redirectUri);
      redirectUrl.searchParams.set('code', code);
      if (state) redirectUrl.searchParams.set('state', state);

      req.session.save(() => {
        res.redirect(redirectUrl.toString());
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /oauth/token
// ---------------------------------------------------------------------------

router.post(
  '/token',
  [
    body('grant_type')
      .isIn(['authorization_code', 'refresh_token'])
      .withMessage('grant_type must be authorization_code or refresh_token'),
    body('client_id').notEmpty().withMessage('client_id is required'),
  ],
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        oauthError(res, 400, 'invalid_request', errors.array()[0].msg as string);
        return;
      }

      const {
        grant_type: grantType,
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
        refresh_token: refreshTokenRaw,
      } = req.body as Record<string, string | undefined>;

      const client = await findClient(clientId!);
      if (!client) {
        oauthError(res, 401, 'invalid_client', 'Unknown or revoked client.');
        return;
      }

      // Authenticate confidential clients.
      if (!client.is_public) {
        if (!clientSecret || !client.client_secret) {
          oauthError(res, 401, 'invalid_client', 'client_secret is required.');
          return;
        }
        if (!verifyClientSecret(clientId!, clientSecret, client.client_secret)) {
          oauthError(res, 401, 'invalid_client', 'Invalid client_secret.');
          return;
        }
      }

      // ---- authorization_code grant ----
      if (grantType === 'authorization_code') {
        if (!code) {
          oauthError(res, 400, 'invalid_request', 'code is required.');
          return;
        }
        if (!redirectUri) {
          oauthError(res, 400, 'invalid_request', 'redirect_uri is required.');
          return;
        }

        const authCode = await consumeAuthorizationCode(code);
        if (!authCode) {
          oauthError(res, 400, 'invalid_grant', 'Authorization code is invalid, expired, or already used.');
          return;
        }

        if (authCode.client_id !== clientId) {
          oauthError(res, 400, 'invalid_grant', 'Authorization code was issued for a different client.');
          return;
        }

        if (authCode.redirect_uri !== redirectUri) {
          oauthError(res, 400, 'invalid_grant', 'redirect_uri does not match the one used during authorization.');
          return;
        }

        // Defense-in-depth: public clients must always provide PKCE, regardless
        // of whether the DB row has a code_challenge (guards against forged entries).
        if (client.is_public && (!authCode.code_challenge || !codeVerifier)) {
          oauthError(res, 400, 'invalid_grant', 'Public clients must use PKCE (code_verifier is required).');
          return;
        }

        // Verify PKCE for public clients (required) and confidential clients (if they used it).
        if (authCode.code_challenge) {
          if (!codeVerifier) {
            oauthError(res, 400, 'invalid_grant', 'code_verifier is required.');
            return;
          }
          if (!verifyPkce(codeVerifier, authCode.code_challenge)) {
            oauthError(res, 400, 'invalid_grant', 'code_verifier does not match code_challenge.');
            return;
          }
        }

        const tokens = await issueTokenPair({
          clientId: clientId!,
          userId: authCode.user_id,
          scopes: authCode.scopes,
        });

        res.json({
          access_token: tokens.accessToken,
          token_type: 'Bearer',
          expires_in: tokens.expiresIn,
          refresh_token: tokens.refreshToken,
          scope: tokens.scope,
        });
        return;
      }

      // ---- refresh_token grant ----
      if (grantType === 'refresh_token') {
        if (!refreshTokenRaw) {
          oauthError(res, 400, 'invalid_request', 'refresh_token is required.');
          return;
        }

        // Look up the user so we can re-issue with the same userId and scopes.
        const hashValue = crypto.createHash('sha256').update(refreshTokenRaw).digest('hex');
        const rtResult = await pool.query(
          `SELECT user_id, scopes
           FROM oauth_refresh_tokens
           WHERE token_hash = $1
             AND rotated_at IS NULL
             AND revoked_at IS NULL
             AND expires_at > NOW()
             AND client_id = $2`,
          [hashValue, clientId],
        );

        if (rtResult.rows.length === 0) {
          oauthError(res, 400, 'invalid_grant', 'Refresh token is invalid, expired, or already used.');
          return;
        }

        const rtRow = rtResult.rows[0] as { user_id: number; scopes: string[] };

        const tokens = await rotateRefreshToken(refreshTokenRaw, {
          clientId: clientId!,
          userId: rtRow.user_id,
          scopes: rtRow.scopes,
        });

        if (!tokens) {
          oauthError(res, 400, 'invalid_grant', 'Could not rotate refresh token.');
          return;
        }

        res.json({
          access_token: tokens.accessToken,
          token_type: 'Bearer',
          expires_in: tokens.expiresIn,
          refresh_token: tokens.refreshToken,
          scope: tokens.scope,
        });
        return;
      }
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /oauth/revoke  (RFC 7009)
// ---------------------------------------------------------------------------

router.post(
  '/revoke',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { token, token_type_hint: hint, client_id: clientId, client_secret: clientSecret } =
        req.body as Record<string, string | undefined>;

      if (!token || !clientId) {
        // Per RFC 7009 §2.2, always return 200.
        res.json({ revoked: false });
        return;
      }

      const client = await findClient(clientId);
      if (!client) {
        res.json({ revoked: false });
        return;
      }

      if (!client.is_public) {
        if (!clientSecret || !client.client_secret || !verifyClientSecret(clientId, clientSecret, client.client_secret)) {
          res.json({ revoked: false });
          return;
        }
      }

      if (hint === 'refresh_token') {
        await revokeRefreshToken(token, clientId);
      } else if (hint === 'access_token') {
        await revokeAccessToken(token, clientId);
      } else {
        // Try access token first, then refresh token.
        await revokeAccessToken(token, clientId);
        await revokeRefreshToken(token, clientId);
      }

      res.json({ revoked: true });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /oauth/apps  — list apps the authenticated user has consented to
// ---------------------------------------------------------------------------

router.get(
  '/apps',
  requireAuth,
  requireScope('oauth:apps:read'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user as User;

      const result = await pool.query(
        `SELECT c.client_id, c.name, co.scopes, co.granted_at
         FROM oauth_consents co
         JOIN oauth_clients c ON c.client_id = co.client_id
         WHERE co.user_id = $1
           AND co.revoked_at IS NULL
           AND c.revoked_at IS NULL
         ORDER BY co.granted_at DESC`,
        [user.id],
      );

      res.json(
        (result.rows as Array<{ client_id: string; name: string; scopes: string[]; granted_at: Date }>).map((r) => ({
          clientId: r.client_id,
          name: r.name,
          scopes: r.scopes,
          grantedAt: r.granted_at,
        })),
      );
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /oauth/apps  — register a new OAuth client
// ---------------------------------------------------------------------------

router.post(
  '/apps',
  requireAuth,
  requireScope('oauth:apps:write'),
  [
    body('name').isString().notEmpty().withMessage('name is required'),
    body('redirectUris')
      .isArray({ min: 1 })
      .withMessage('redirectUris must be a non-empty array'),
    body('redirectUris.*')
      .isString()
      .notEmpty()
      .withMessage('Each redirectUri must be a non-empty string')
      .custom((uri: string) => {
        const error = validateRedirectUri(uri);
        if (error) throw new Error(error);
        return true;
      }),
    body('scopes')
      .isArray({ min: 1 })
      .withMessage('scopes must be a non-empty array'),
    body('scopes.*')
      .custom((s: string) => isValidScope(s))
      .withMessage(`Each scope must be one of: ${VALID_SCOPES.join(', ')}`),
    body('isPublic').isBoolean().withMessage('isPublic must be a boolean'),
  ],
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const user = req.user as User;
      const { name, redirectUris, scopes, isPublic } = req.body as {
        name: string;
        redirectUris: string[];
        scopes: string[];
        isPublic: boolean;
      };

      const { client, rawSecret } = await createClient({
        userId: user.id,
        name,
        redirectUris,
        scopes,
        isPublic,
      });

      res.status(201).json({
        clientId: client.client_id,
        clientSecret: rawSecret,
        name: client.name,
        isPublic: client.is_public,
        redirectUris: client.redirect_uris,
        scopes: client.scopes,
        createdAt: client.created_at,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// DELETE /oauth/apps/:clientId  — revoke client or consent
// ---------------------------------------------------------------------------

router.delete(
  '/apps/:clientId',
  requireAuth,
  requireScope('oauth:apps:write'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user as User;
      const clientId = req.params.clientId as string;

      const client = await findClient(clientId);
      if (!client) {
        res.status(404).json({ error: 'Client not found.' });
        return;
      }

      const isOwner = client.user_id === user.id;
      const isAdmin = user.role === 'admin';

      if (!isOwner && !isAdmin) {
        res.status(403).json({ error: 'Forbidden.' });
        return;
      }

      // Full revocation: mark client as revoked and cascade to active tokens.
      await pool.query(
        'UPDATE oauth_clients SET revoked_at = NOW() WHERE client_id = $1',
        [clientId],
      );
      await pool.query(
        'UPDATE oauth_access_tokens SET revoked_at = NOW() WHERE client_id = $1 AND revoked_at IS NULL',
        [clientId],
      );
      await pool.query(
        'UPDATE oauth_refresh_tokens SET revoked_at = NOW() WHERE client_id = $1 AND revoked_at IS NULL',
        [clientId],
      );
      await pool.query(
        'UPDATE oauth_consents SET revoked_at = NOW() WHERE client_id = $1',
        [clientId],
      );

      res.json({ message: 'Application revoked.' });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
