import { customAlphabet } from 'nanoid';
import { Pool } from 'pg';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SHORT_CODE_LENGTH = 6;
const MAX_COLLISION_RETRIES = 10;

const nanoid = customAlphabet(ALPHABET, SHORT_CODE_LENGTH);

/**
 * Generate a unique short code, retrying up to MAX_COLLISION_RETRIES times on collision.
 */
export async function generateShortCode(pool: Pool): Promise<string | null> {
  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
    const code = nanoid();
    const result = await pool.query('SELECT 1 FROM urls WHERE short_code = $1', [code]);
    if (result.rows.length === 0) {
      return code;
    }
  }
  return null;
}
