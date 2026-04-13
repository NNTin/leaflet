import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../db';
import { generateShortCode } from '../shortcode';
import { ensureScopeForOAuthRequest, optionalBearerAuth, requireAdmin, requireAuth, requireScope } from '../middleware/auth';
import { User } from '../models/user';
import { publicShortUrlBase, defaultFrontendUrl } from '../config';
import {
  getShortenCapabilities,
  getShortenTtlOptions,
  SHORTEN_TTL_MAP,
  SHORTEN_TTL_VALUES,
  type ShortenTtl,
  canRoleUseCustomAlias,
  canRoleUseNeverTtl,
} from '../shorten-policy';

const router = express.Router();
export type ShortenAuthMode = 'session' | 'public';

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

function getShortenCallerUser(req: Request, mode: ShortenAuthMode): User | null {
  if (mode === 'public' && req.oauthAuthenticated !== true) {
    return null;
  }

  return (req.user as User) ?? null;
}

function buildShortenCapabilities(req: Request, mode: ShortenAuthMode) {
  const user = getShortenCallerUser(req, mode);
  return getShortenCapabilities({
    user,
    oauthAuthenticated: req.oauthAuthenticated === true,
    oauthScopes: req.oauthScopes,
  });
}

export const shortenValidators = [
  body('url').isURL({ protocols: ['http', 'https'], require_protocol: true }).withMessage('A valid HTTP/HTTPS URL is required'),
  body('ttl').isIn(SHORTEN_TTL_VALUES).withMessage(`TTL must be one of: ${SHORTEN_TTL_VALUES.join(', ')}`),
  body('alias')
    .optional()
    .matches(/^[a-zA-Z0-9-_]+$/)
    .isLength({ min: 3, max: 50 })
    .withMessage('Alias must be 3-50 characters (letters, numbers, hyphens, underscores)'),
];

export function createShortenCapabilitiesHandler(mode: ShortenAuthMode): RequestHandler {
  return (req: Request, res: Response) => {
    res.json(buildShortenCapabilities(req, mode));
  };
}

export function createShortenHandler(mode: ShortenAuthMode): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { url, ttl, alias } = req.body as { url: string; ttl: string; alias?: string };
      const user = getShortenCallerUser(req, mode);

      if (!ensureScopeForOAuthRequest(req, res, 'shorten:create')) {
        return;
      }

      if (ttl === 'never') {
        if (!ensureScopeForOAuthRequest(req, res, 'shorten:create:never')) {
          return;
        }

        if (!canRoleUseNeverTtl(user?.role ?? null)) {
          return res.status(403).json({ error: 'Admin access required to create links with no expiration.' });
        }
      }

      if (alias) {
        if (!ensureScopeForOAuthRequest(req, res, 'shorten:create:alias')) {
          return;
        }

        if (!canRoleUseCustomAlias(user?.role ?? null)) {
          return res.status(403).json({ error: 'Privileged account required for custom aliases.' });
        }
      }

      const allowedTtls = getShortenTtlOptions({
        user,
        oauthAuthenticated: req.oauthAuthenticated === true,
        oauthScopes: req.oauthScopes,
      }).map(({ value }) => value);

      if (!allowedTtls.includes(ttl as ShortenTtl)) {
        return res.status(403).json({
          error: 'This TTL option is not available for your account.',
          hint: `Allowed TTL values for your current role and authentication: ${allowedTtls.length > 0 ? allowedTtls.join(', ') : 'none'}`,
        });
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

      const ttlMs = SHORTEN_TTL_MAP[ttl as ShortenTtl];
      const expiresAt = ttlMs !== null && ttlMs !== undefined ? new Date(Date.now() + ttlMs) : null;

      const result = await pool.query(
        `INSERT INTO urls (short_code, original_url, user_id, expires_at, is_custom)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING short_code, expires_at`,
        [shortCode, url, user ? user.id : null, expiresAt, isCustom]
      );

      const row = result.rows[0] as { short_code: string; expires_at: Date | null };

      res.status(201).json({
        shortCode: row.short_code,
        shortUrl: `${publicShortUrlBase}/${encodeURIComponent(row.short_code)}`,
        expiresAt: row.expires_at,
      });
    } catch (err) {
      next(err);
    }
  };
}

export async function redirectShortCode(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code } = req.params;
    const result = await pool.query(
      `SELECT original_url FROM urls
       WHERE short_code = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [code]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Short URL not found or has expired.' });
      return;
    }

    res.redirect(302, result.rows[0].original_url as string);
  } catch (err) {
    next(err);
  }
}

/**
 * Handler for canonical human-facing short links (GET /s/:code).
 *
 * Active links: 302 redirect to the original URL (same as the API handler).
 * Missing/expired links: browser requests (Accept: text/html) are redirected
 *   to the frontend expired page so users see the branded experience.
 *   Machine callers (API/JSON) receive a 404 JSON response.
 */
export async function humanRedirectShortCode(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { code } = req.params;
    const result = await pool.query(
      `SELECT original_url FROM urls
       WHERE short_code = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [code]
    );

    if (result.rows.length === 0) {
      const acceptHeader = req.headers['accept'] ?? '';
      if (acceptHeader.includes('text/html')) {
        const expiredUrl = `${defaultFrontendUrl.replace(/\/+$/, '')}/expired`;
        res.redirect(302, expiredUrl);
        return;
      }
      res.status(404).json({ error: 'Short URL not found or has expired.' });
      return;
    }

    res.redirect(302, result.rows[0].original_url as string);
  } catch (err) {
    next(err);
  }
}

router.get('/shorten/capabilities', optionalBearerAuth, createShortenCapabilitiesHandler('session'));

router.post('/shorten', optionalBearerAuth, shortenValidators, createShortenHandler('session'));

router.get('/urls', requireAuth, requireScope('urls:read'), requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
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

router.delete('/urls/:id', requireAuth, requireScope('urls:delete'), requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
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

router.get('/:code', redirectShortCode);

export default router;
