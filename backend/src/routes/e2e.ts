/**
 * Test-only routes for end-to-end testing.
 *
 * These routes are ONLY registered when E2E_TEST_MODE=true.
 * They must never be enabled in production.
 *
 * Mounted at /e2e by app.ts when E2E_TEST_MODE=true.
 */

import crypto from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import pool from '../db';
import { User } from '../models/user';

const router = express.Router();

// ---------------------------------------------------------------------------
// POST /auth/e2e/login
// Creates (or finds) a test user and establishes a session.
// Returns the CSRF token so test callers can make subsequent mutation requests.
// ---------------------------------------------------------------------------

router.post('/login', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const username: string = typeof req.body.username === 'string' && req.body.username.trim()
      ? req.body.username.trim()
      : 'e2e-user';
    const role: string = typeof req.body.role === 'string' && ['user', 'privileged', 'admin'].includes(req.body.role)
      ? req.body.role
      : 'user';

    // Find or create the test user.
    let result = await pool.query<User>('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) {
      result = await pool.query<User>(
        'INSERT INTO users (username, role) VALUES ($1, $2) RETURNING *',
        [username, role],
      );
    }
    const user = result.rows[0];

    req.login(user, (loginErr) => {
      if (loginErr) return next(loginErr);

      // Ensure a CSRF token is present in the session so callers can
      // immediately make mutations without a separate round-trip.
      if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      }

      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.json({
          success: true,
          userId: user.id,
          username: user.username,
          role: user.role,
          csrfToken: req.session.csrfToken,
        });
      });
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/e2e/reset
// Truncates all user/URL data and re-seeds the built-in OAuth client.
// Useful for resetting state between test runs without restarting the process.
// ---------------------------------------------------------------------------

router.post('/reset', async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Truncate in reverse dependency order.
    await pool.query(`
      TRUNCATE
        account_merge_log,
        oauth_access_tokens,
        oauth_authorization_codes,
        oauth_refresh_tokens,
        oauth_consents,
        oauth_clients,
        user_identities,
        urls,
        users
      RESTART IDENTITY CASCADE
    `);

    // Re-seed the built-in leaflet-cli public client removed by the truncate.
    await pool.query(`
      INSERT INTO oauth_clients (name, client_id, client_secret, is_public, redirect_uris, scopes)
      VALUES (
        'Leaflet CLI',
        'leaflet-cli',
        NULL,
        TRUE,
        ARRAY['http://localhost'],
        ARRAY['shorten:create', 'shorten:create:never', 'shorten:create:alias',
              'urls:read', 'urls:delete', 'user:read', 'admin:*']
      )
      ON CONFLICT (client_id) DO NOTHING
    `);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
