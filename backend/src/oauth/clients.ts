import crypto from 'crypto';
import pool from '../db';

export interface OAuthClient {
  id: string;
  user_id: number | null;
  name: string;
  client_id: string;
  client_secret: string | null;
  is_public: boolean;
  redirect_uris: string[];
  scopes: string[];
  created_at: Date;
  revoked_at: Date | null;
}

/**
 * Hashes a client secret using SHA-256 with client_id as a domain separator,
 * so the same raw secret stored for two different clients produces different hashes.
 *
 * SHA-256 is appropriate here rather than a password-hashing function such as
 * bcrypt because client secrets are cryptographically random 32-byte values
 * (256 bits of entropy). High-entropy random secrets are not vulnerable to
 * dictionary or rainbow-table attacks, and SHA-256's speed is not a concern
 * at this entropy level. Using a simpler hash keeps the verification path fast
 * and dependency-free.
 */
export function hashClientSecret(clientId: string, rawSecret: string): string {
  return crypto
    .createHash('sha256')
    .update(`${clientId}:${rawSecret}`)
    .digest('hex');
}

export function verifyClientSecret(
  clientId: string,
  rawSecret: string,
  storedHash: string,
): boolean {
  const expected = hashClientSecret(clientId, rawSecret);
  if (expected.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(storedHash));
}

export async function findClient(clientId: string): Promise<OAuthClient | null> {
  const result = await pool.query(
    'SELECT * FROM oauth_clients WHERE client_id = $1 AND revoked_at IS NULL',
    [clientId],
  );
  return result.rows.length > 0 ? (result.rows[0] as OAuthClient) : null;
}

/**
 * Validates whether a redirect_uri is acceptable for a client.
 * For public clients with a stored URI of 'http://localhost' or 'http://127.0.0.1',
 * any port on loopback is accepted per RFC 8252 §8.3.
 */
export function isValidRedirectUri(client: OAuthClient, redirectUri: string): boolean {
  return client.redirect_uris.some((stored) => {
    if (stored === 'http://localhost' || stored === 'http://127.0.0.1') {
      try {
        const parsed = new URL(redirectUri);
        return (
          (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') &&
          parsed.protocol === 'http:'
        );
      } catch {
        return false;
      }
    }
    if (stored === 'urn:ietf:wg:oauth:2.0:oob') {
      return redirectUri === 'urn:ietf:wg:oauth:2.0:oob';
    }
    return stored === redirectUri;
  });
}

export async function createClient(params: {
  userId: number | null;
  name: string;
  redirectUris: string[];
  scopes: string[];
  isPublic: boolean;
}): Promise<{ client: OAuthClient; rawSecret: string | null }> {
  const clientId = crypto.randomBytes(16).toString('hex');
  let rawSecret: string | null = null;
  let secretHash: string | null = null;

  if (!params.isPublic) {
    rawSecret = crypto.randomBytes(32).toString('hex');
    secretHash = hashClientSecret(clientId, rawSecret);
  }

  const result = await pool.query(
    `INSERT INTO oauth_clients
       (user_id, name, client_id, client_secret, is_public, redirect_uris, scopes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      params.userId,
      params.name,
      clientId,
      secretHash,
      params.isPublic,
      params.redirectUris,
      params.scopes,
    ],
  );

  return { client: result.rows[0] as OAuthClient, rawSecret };
}
