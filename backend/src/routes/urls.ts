import express, { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../db';
import { generateShortCode } from '../shortcode';
import { requireAuth, requireAdmin, optionalApiKeyAuth } from '../middleware/auth';
import { User } from '../models/user';

const router = express.Router();

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

const TTL_MAP: Record<string, number | null> = {
  '5m': 5 * SECONDS_PER_MINUTE * MS_PER_SECOND,
  '1h': MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND,
  '24h': HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND,
  'never': null,
};

interface UrlRow {
  id: number;
  short_code: string;
  original_url: string;
  created_at: Date;
  expires_at: Date | null;
  is_custom: boolean;
  created_by?: string | null;
}

function toUrlDto(row: UrlRow) {
  return {
    id: row.id,
    shortCode: row.short_code,
    originalUrl: row.original_url,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    isCustom: row.is_custom,
    createdBy: row.created_by ?? null,
  };
}

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
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { url, ttl, alias } = req.body as { url: string; ttl: string; alias?: string };
      const user = (req.user as User) ?? null;

      if (ttl === 'never' && (!user || user.role !== 'admin')) {
        return res.status(403).json({ error: 'Only admins can create links with no expiration.' });
      }

      if (alias && (!user || (user.role !== 'privileged' && user.role !== 'admin'))) {
        return res.status(403).json({ error: 'Custom aliases require a privileged account.' });
      }

      let shortCode: string;
      let isCustom = false;

      if (alias) {
        const existing = await pool.query('SELECT id FROM urls WHERE short_code = $1', [alias]);
        if (existing.rows.length > 0) {
          return res.status(409).json({ error: 'This alias is already in use.' });
        }
        shortCode = alias;
        isCustom = true;
      } else {
        const generated = await generateShortCode(pool);
        if (!generated) {
          return res.status(500).json({ error: 'Could not generate a unique short code. Please try again.' });
        }
        shortCode = generated;
      }

      const ttlMs = TTL_MAP[ttl];
      const expiresAt = ttlMs !== null && ttlMs !== undefined ? new Date(Date.now() + ttlMs) : null;

      const result = await pool.query(
        `INSERT INTO urls (short_code, original_url, user_id, expires_at, is_custom)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING short_code, expires_at`,
        [shortCode, url, user ? user.id : null, expiresAt, isCustom]
      );

      const row = result.rows[0] as { short_code: string; expires_at: Date | null };
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

router.get('/urls', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.short_code, u.original_url, u.created_at, u.expires_at, u.is_custom,
              us.username AS created_by
       FROM urls u
       LEFT JOIN users us ON u.user_id = us.id
       ORDER BY u.created_at DESC`
    );
    res.json((result.rows as UrlRow[]).map(toUrlDto));
  } catch (err) {
    next(err);
  }
});

router.delete('/urls/:id', requireAuth, requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
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

router.get('/:code', async (req: Request, res: Response, next: NextFunction) => {
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

    res.redirect(302, result.rows[0].original_url as string);
  } catch (err) {
    next(err);
  }
});

export default router;
