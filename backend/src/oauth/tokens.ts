import crypto from 'crypto';
import pool from '../db';

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}

export interface AccessTokenInfo {
  userId: number;
  clientId: string;
  scopes: string[];
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generateRawToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function issueTokenPair(params: {
  clientId: string;
  userId: number;
  scopes: string[];
}): Promise<TokenPair> {
  const rawAccess = generateRawToken();
  const rawRefresh = generateRawToken();
  const accessHash = hashToken(rawAccess);
  const refreshHash = hashToken(rawRefresh);
  const now = Date.now();
  const accessExpiry = new Date(now + ACCESS_TOKEN_TTL_MS);
  const refreshExpiry = new Date(now + REFRESH_TOKEN_TTL_MS);

  const accessResult = await pool.query(
    `INSERT INTO oauth_access_tokens
       (token_hash, client_id, user_id, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [accessHash, params.clientId, params.userId, params.scopes, accessExpiry],
  );

  const accessTokenId = (accessResult.rows[0] as { id: string }).id;

  await pool.query(
    `INSERT INTO oauth_refresh_tokens
       (token_hash, access_token_id, client_id, user_id, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      refreshHash,
      accessTokenId,
      params.clientId,
      params.userId,
      params.scopes,
      refreshExpiry,
    ],
  );

  return {
    accessToken: rawAccess,
    refreshToken: rawRefresh,
    expiresIn: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    scope: params.scopes.join(' '),
  };
}

/**
 * Consumes the old refresh token (marks it as rotated) and issues a new token pair.
 * Returns null if the token is invalid, expired, or already rotated/revoked.
 */
export async function rotateRefreshToken(
  rawRefreshToken: string,
  params: { clientId: string; userId: number; scopes: string[] },
): Promise<TokenPair | null> {
  const hash = hashToken(rawRefreshToken);

  const result = await pool.query(
    `UPDATE oauth_refresh_tokens
     SET rotated_at = NOW()
     WHERE token_hash = $1
       AND rotated_at IS NULL
       AND revoked_at IS NULL
       AND expires_at > NOW()
       AND client_id  = $2
       AND user_id    = $3
     RETURNING id`,
    [hash, params.clientId, params.userId],
  );

  if (result.rows.length === 0) return null;

  return issueTokenPair(params);
}

/**
 * Verifies a raw access token and returns its metadata.
 * Returns null if the token is unknown, revoked, or expired.
 */
export async function verifyAccessToken(
  rawToken: string,
): Promise<AccessTokenInfo | null> {
  const hash = hashToken(rawToken);

  const result = await pool.query(
    `SELECT user_id, client_id, scopes
     FROM oauth_access_tokens
     WHERE token_hash = $1
       AND revoked_at IS NULL
       AND expires_at > NOW()`,
    [hash],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0] as {
    user_id: number;
    client_id: string;
    scopes: string[];
  };

  return { userId: row.user_id, clientId: row.client_id, scopes: row.scopes };
}

export async function revokeAccessToken(
  rawToken: string,
  clientId: string,
): Promise<void> {
  const hash = hashToken(rawToken);
  await pool.query(
    `UPDATE oauth_access_tokens
     SET revoked_at = NOW()
     WHERE token_hash = $1 AND client_id = $2`,
    [hash, clientId],
  );
}

export async function revokeRefreshToken(
  rawToken: string,
  clientId: string,
): Promise<void> {
  const hash = hashToken(rawToken);
  await pool.query(
    `UPDATE oauth_refresh_tokens
     SET revoked_at = NOW()
     WHERE token_hash = $1 AND client_id = $2`,
    [hash, clientId],
  );
}

/**
 * Looks up an access token by its hash and returns the full user row joined in.
 * Used in earlyApiKeyMiddleware to authenticate OAuth tokens.
 */
export async function lookupAccessTokenWithUser(rawToken: string): Promise<{
  userId: number;
  clientId: string;
  scopes: string[];
} | null> {
  const hash = hashToken(rawToken);

  const result = await pool.query(
    `SELECT t.user_id, t.client_id, t.scopes
     FROM oauth_access_tokens t
     WHERE t.token_hash = $1
       AND t.revoked_at IS NULL
       AND t.expires_at > NOW()`,
    [hash],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0] as {
    user_id: number;
    client_id: string;
    scopes: string[];
  };

  return { userId: row.user_id, clientId: row.client_id, scopes: row.scopes };
}
