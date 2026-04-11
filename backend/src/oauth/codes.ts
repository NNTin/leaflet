import crypto from 'crypto';
import pool from '../db';

export interface AuthorizationCode {
  id: string;
  code: string;
  client_id: string;
  user_id: number;
  redirect_uri: string;
  scopes: string[];
  code_challenge: string | null;
  code_challenge_method: string;
  expires_at: Date;
  used_at: Date | null;
}

const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export async function issueAuthorizationCode(params: {
  clientId: string;
  userId: number;
  redirectUri: string;
  scopes: string[];
  codeChallenge?: string;
  codeChallengeMethod?: string;
}): Promise<string> {
  const code = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await pool.query(
    `INSERT INTO oauth_authorization_codes
       (code, client_id, user_id, redirect_uri, scopes,
        code_challenge, code_challenge_method, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      code,
      params.clientId,
      params.userId,
      params.redirectUri,
      params.scopes,
      params.codeChallenge ?? null,
      params.codeChallengeMethod ?? 'S256',
      expiresAt,
    ],
  );

  return code;
}

/**
 * Marks the code as used and returns it.
 * Returns null if the code does not exist, is already used, or is expired.
 * The single-row UPDATE is atomic — concurrent calls cannot both succeed.
 */
export async function consumeAuthorizationCode(
  code: string,
): Promise<AuthorizationCode | null> {
  const result = await pool.query(
    `UPDATE oauth_authorization_codes
     SET used_at = NOW()
     WHERE code = $1
       AND used_at IS NULL
       AND expires_at > NOW()
     RETURNING *`,
    [code],
  );
  return result.rows.length > 0 ? (result.rows[0] as AuthorizationCode) : null;
}
