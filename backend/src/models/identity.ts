import pool from '../db';

export type ProviderName = 'github' | 'google' | 'discord' | 'microsoft' | 'apple';

export interface Identity {
  id: number;
  user_id: number;
  provider: ProviderName;
  provider_user_id: string;
  display_name: string | null;
  email: string | null;
  email_verified: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface NormalizedProfile {
  provider: ProviderName;
  providerUserId: string;
  displayName: string;
  email: string | null;
  emailVerified: boolean;
}

/**
 * Find an identity row by provider + provider_user_id.
 */
export async function findIdentityByProvider(
  provider: ProviderName,
  providerUserId: string,
): Promise<Identity | null> {
  const result = await pool.query<Identity>(
    `SELECT * FROM user_identities WHERE provider = $1 AND provider_user_id = $2`,
    [provider, providerUserId],
  );
  return result.rows[0] ?? null;
}

/**
 * Upsert an identity for a given user.  If a row already exists for
 * (user_id, provider), it is updated.  If none exists it is inserted.
 * The (provider, provider_user_id) unique constraint is enforced at the
 * database level – callers must check for conflicts before calling this.
 */
export async function upsertIdentity(
  userId: number,
  profile: NormalizedProfile,
): Promise<Identity> {
  const result = await pool.query<Identity>(
    `INSERT INTO user_identities (user_id, provider, provider_user_id, display_name, email, email_verified, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (user_id, provider)
     DO UPDATE SET
       provider_user_id = EXCLUDED.provider_user_id,
       display_name     = EXCLUDED.display_name,
       email            = EXCLUDED.email,
       email_verified   = EXCLUDED.email_verified,
       updated_at       = NOW()
     RETURNING *`,
    [
      userId,
      profile.provider,
      profile.providerUserId,
      profile.displayName,
      profile.email,
      profile.emailVerified,
    ],
  );
  return result.rows[0];
}

/**
 * List all identities attached to a user, ordered by creation time.
 */
export async function listIdentitiesForUser(userId: number): Promise<Identity[]> {
  const result = await pool.query<Identity>(
    `SELECT * FROM user_identities WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId],
  );
  return result.rows;
}

/**
 * Delete a single identity row.  The caller is responsible for enforcing the
 * "cannot delete last identity" guard before calling this.
 */
export async function deleteIdentity(userId: number, provider: ProviderName): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM user_identities WHERE user_id = $1 AND provider = $2`,
    [userId, provider],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Count how many identities a user has.  Used to prevent removing the last one.
 */
export async function countIdentitiesForUser(userId: number): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM user_identities WHERE user_id = $1`,
    [userId],
  );
  return parseInt(result.rows[0].count, 10);
}

/**
 * Find or create a user row for an incoming OAuth profile.
 * Returns the (possibly newly created) user row.
 */
export async function findOrCreateUserByIdentity(
  profile: NormalizedProfile,
): Promise<{ id: number; username: string; role: string; created_at: Date }> {
  // Check if an identity row already exists.
  const existing = await findIdentityByProvider(profile.provider, profile.providerUserId);
  if (existing) {
    // Update the identity metadata and return the associated user.
    await upsertIdentity(existing.user_id, profile);
    const userResult = await pool.query<{ id: number; username: string; role: string; created_at: Date }>(
      `SELECT id, username, role, created_at FROM users WHERE id = $1`,
      [existing.user_id],
    );
    if (userResult.rows.length === 0) {
      throw new Error(`User ${existing.user_id} referenced by identity not found.`);
    }
    return userResult.rows[0];
  }

  // Create a new user row, then attach the identity.
  const userResult = await pool.query<{ id: number; username: string; role: string; created_at: Date }>(
    `INSERT INTO users (username, role)
     VALUES ($1, $2)
     RETURNING id, username, role, created_at`,
    [profile.displayName, 'user'],
  );
  const newUser = userResult.rows[0];

  await upsertIdentity(newUser.id, profile);

  return newUser;
}
