const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const pool = require('../db');
const { generateShortCode } = require('../shortcode');
const { requireAuth, requireAdmin, optionalApiKeyAuth } = require('../middleware/auth');

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

const TTL_MAP = {
  '5m': 5 * SECONDS_PER_MINUTE * MS_PER_SECOND,
  '1h': MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND,
  '24h': HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND,
  'never': null,
};

/** Convert snake_case URL row to camelCase for API responses */
function toUrlDto(row) {
  return {
    id: row.id,
    shortCode: row.short_code,
    originalUrl: row.original_url,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    isCustom: row.is_custom,
    createdBy: row.created_by || null,
  };
}

// POST /api/shorten - create a short URL
router.post(
  '/shorten',
  optionalApiKeyAuth,
  [
    body('url').isURL({ protocols: ['http', 'https'], require_protocol: true }).withMessage('A valid HTTP/HTTPS URL is required'),
    body('ttl').isIn(['5m', '1h', '24h', 'never']).withMessage('TTL must be one of: 5m, 1h, 24h, never'),
    body('alias')
      .optional()
      .matches(/^[a-zA-Z0-9-_]+$/)
      .isLength({ min: 3, max: 50 })
      .withMessage('Alias must be 3-50 characters (letters, numbers, hyphens, underscores)'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { url, ttl, alias } = req.body;
      const user = req.user || null;

      // Only admins can use ttl=never
      if (ttl === 'never' && (!user || user.role !== 'admin')) {
        return res.status(403).json({ error: 'Only admins can create links with no expiration.' });
      }

      // Only privileged users and admins can use custom aliases
      if (alias && (!user || (user.role !== 'privileged' && user.role !== 'admin'))) {
        return res.status(403).json({ error: 'Custom aliases require a privileged account.' });
      }

      let shortCode;
      let isCustom = false;

      if (alias) {
        // Verify alias is not already taken
        const existing = await pool.query('SELECT id FROM urls WHERE short_code = $1', [alias]);
        if (existing.rows.length > 0) {
          return res.status(409).json({ error: 'This alias is already in use.' });
        }
        shortCode = alias;
        isCustom = true;
      } else {
        shortCode = await generateShortCode(pool);
        if (!shortCode) {
          return res.status(500).json({ error: 'Could not generate a unique short code. Please try again.' });
        }
      }

      const ttlMs = TTL_MAP[ttl];
      const expiresAt = ttlMs !== null ? new Date(Date.now() + ttlMs) : null;

      const result = await pool.query(
        `INSERT INTO urls (short_code, original_url, user_id, expires_at, is_custom)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING short_code, expires_at`,
        [shortCode, url, user ? user.id : null, expiresAt, isCustom]
      );

      const row = result.rows[0];
      // Public short URL goes through the SPA /s/:code route so users see the
      // friendly expired/not-found page when a link is missing or expired.
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

      res.status(201).json({
        shortCode: row.short_code,
        shortUrl: `${frontendUrl}/s/${row.short_code}`,
        expiresAt: row.expires_at,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/urls - admin only: list all URLs (camelCase response)
router.get('/urls', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.short_code, u.original_url, u.created_at, u.expires_at, u.is_custom,
              us.username AS created_by
       FROM urls u
       LEFT JOIN users us ON u.user_id = us.id
       ORDER BY u.created_at DESC`
    );
    res.json(result.rows.map(toUrlDto));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/urls/:id - admin only: delete a URL
router.delete('/urls/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM urls WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'URL not found.' });
    }
    res.json({ message: 'URL deleted successfully.' });
  } catch (err) {
    next(err);
  }
});

// GET /api/:code - redirect to original URL (wildcard must come last)
router.get('/:code', async (req, res, next) => {
  try {
    const { code } = req.params;

    const result = await pool.query(
      `SELECT original_url FROM urls
       WHERE short_code = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Short URL not found or has expired.' });
    }

    res.redirect(302, result.rows[0].original_url);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
