const { customAlphabet } = require('nanoid');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const nanoid = customAlphabet(ALPHABET, 6);

/**
 * Generate a unique 6-character short code, retrying up to 10 times on collision.
 * @param {import('pg').Pool} pool - PostgreSQL connection pool
 * @returns {Promise<string|null>} unique short code, or null if all attempts failed
 */
async function generateShortCode(pool) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = nanoid();
    const result = await pool.query('SELECT 1 FROM urls WHERE short_code = $1', [code]);
    if (result.rows.length === 0) {
      return code;
    }
  }
  return null;
}

module.exports = { generateShortCode };
