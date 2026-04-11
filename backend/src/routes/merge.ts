/**
 * Account merge routes.
 *
 * Merge flow:
 *   1. POST /auth/merge/initiate  — identify the target user and generate a
 *      one-time confirmation token (stored in session).
 *   2. POST /auth/merge/confirm   — echo the token back to confirm; the
 *      merge is executed in a single database transaction.
 *
 * The initiating user retains their account (the "surviving" user).
 * The target user's identities, URLs, and OAuth resources are moved to the
 * surviving user and the target user row is deleted.
 *
 * Security notes:
 *   - Both endpoints require an active browser session (requireAuth).
 *   - The merge token is a 32-byte random value with a 10-minute TTL.
 *   - Sensitive token values are never logged.
 *   - The merge is atomic: all DB writes happen inside a transaction.
 */

import crypto from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import pool from '../db';
import { User } from '../models/user';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

const MERGE_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// POST /auth/merge/initiate
// ---------------------------------------------------------------------------

router.post('/initiate', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const currentUser = req.user as User;

    // If we got here via a linking conflict, use the conflicting userId as the
    // default target so the caller does not need to specify it explicitly.
    const rawTargetId: unknown =
      req.body?.targetUserId ?? req.session.linkConflict?.conflictingUserId;

    const targetUserId = typeof rawTargetId === 'number'
      ? rawTargetId
      : typeof rawTargetId === 'string'
        ? parseInt(rawTargetId, 10)
        : NaN;

    if (isNaN(targetUserId)) {
      res.status(400).json({
        success: false,
        error: 'targetUserId is required.',
        hint: 'POST { "targetUserId": <number> } or initiate from a link-conflict flow.',
      });
      return;
    }

    if (targetUserId === currentUser.id) {
      res.status(400).json({ success: false, error: 'Cannot merge an account with itself.' });
      return;
    }

    const targetResult = await pool.query<{ id: number; username: string; role: string }>(
      `SELECT id, username, role FROM users WHERE id = $1`,
      [targetUserId],
    );

    if (targetResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Target user not found.' });
      return;
    }

    const targetUser = targetResult.rows[0];

    const token = crypto.randomBytes(32).toString('hex');
    req.session.pendingMerge = {
      token,
      targetUserId,
      expiresAt: Date.now() + MERGE_TOKEN_TTL_MS,
    };

    // Log merge initiation without the token value.
    console.info(`[merge] User ${currentUser.id} initiated merge with user ${targetUserId}.`);

    res.json({
      success: true,
      mergeToken: token,
      targetUser: { id: targetUser.id, username: targetUser.username },
      expiresAt: new Date(req.session.pendingMerge.expiresAt).toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /auth/merge/confirm
// ---------------------------------------------------------------------------

router.post('/confirm', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  const client = await pool.connect();
  try {
    const currentUser = req.user as User;
    const rawToken: unknown = req.body?.mergeToken;

    if (typeof rawToken !== 'string' || !rawToken) {
      res.status(400).json({
        success: false,
        error: 'mergeToken is required.',
        hint: 'Call POST /auth/merge/initiate first to obtain a merge token.',
      });
      return;
    }

    const pendingMerge = req.session.pendingMerge;

    if (!pendingMerge) {
      res.status(400).json({
        success: false,
        error: 'No pending merge found.',
        hint: 'Call POST /auth/merge/initiate to begin the merge flow.',
      });
      return;
    }

    if (Date.now() > pendingMerge.expiresAt) {
      delete req.session.pendingMerge;
      res.status(400).json({
        success: false,
        error: 'Merge token has expired.',
        hint: 'Call POST /auth/merge/initiate again to get a new token.',
      });
      return;
    }

    // Timing-safe token comparison.
    const storedBuf = Buffer.from(pendingMerge.token, 'utf8');
    const providedBuf = Buffer.from(rawToken, 'utf8');
    const tokensMatch =
      storedBuf.length === providedBuf.length &&
      crypto.timingSafeEqual(storedBuf, providedBuf);

    if (!tokensMatch) {
      res.status(403).json({ success: false, error: 'Invalid merge token.' });
      return;
    }

    const survivingUserId = currentUser.id;
    const mergedUserId = pendingMerge.targetUserId;

    // Verify the target still exists.
    const targetCheck = await pool.query(`SELECT id FROM users WHERE id = $1`, [mergedUserId]);
    if (targetCheck.rows.length === 0) {
      delete req.session.pendingMerge;
      res.status(404).json({ success: false, error: 'Target user no longer exists.' });
      return;
    }

    // ---- Execute the merge in a transaction ----
    await client.query('BEGIN');

    // 1. Move identities.
    await client.query(
      `UPDATE user_identities SET user_id = $1 WHERE user_id = $2
       ON CONFLICT (user_id, provider) DO NOTHING`,
      [survivingUserId, mergedUserId],
    );

    // 2. Move URLs.
    await client.query(
      `UPDATE urls SET user_id = $1 WHERE user_id = $2`,
      [survivingUserId, mergedUserId],
    );

    // 3. Move OAuth clients.
    await client.query(
      `UPDATE oauth_clients SET user_id = $1 WHERE user_id = $2`,
      [survivingUserId, mergedUserId],
    );

    // 4. Move OAuth consents (upsert: skip if surviving user already has the same client consent).
    await client.query(
      `UPDATE oauth_consents SET user_id = $1 WHERE user_id = $2
       ON CONFLICT (user_id, client_id) DO NOTHING`,
      [survivingUserId, mergedUserId],
    );

    // 5. Role resolution: surviving user keeps the highest role.
    await client.query(
      `UPDATE users SET role = (
         SELECT CASE
           WHEN 'admin' IN (u1.role, u2.role) THEN 'admin'
           WHEN 'privileged' IN (u1.role, u2.role) THEN 'privileged'
           ELSE 'user'
         END
         FROM users u1, users u2
         WHERE u1.id = $1 AND u2.id = $2
       )
       WHERE id = $1`,
      [survivingUserId, mergedUserId],
    );

    // 6. Audit log.
    await client.query(
      `INSERT INTO account_merge_log (surviving_user_id, merged_user_id, initiated_by)
       VALUES ($1, $2, $3)`,
      [survivingUserId, mergedUserId, survivingUserId],
    );

    // 7. Delete the merged user row (cascades handled by ON DELETE clauses).
    await client.query(`DELETE FROM users WHERE id = $1`, [mergedUserId]);

    await client.query('COMMIT');

    // Clear session state.
    delete req.session.pendingMerge;
    delete req.session.linkConflict;

    console.info(`[merge] User ${survivingUserId} merged user ${mergedUserId} successfully.`);

    res.json({ success: true, message: 'Accounts merged successfully.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

export default router;
