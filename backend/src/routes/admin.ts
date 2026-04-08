import express, { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import pool from '../db';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { User } from '../models/user';

const router = express.Router();

router.use(requireAuth, requireAdmin);

interface UrlRow {
  id: number;
  short_code: string;
  original_url: string;
  created_at: Date;
  expires_at: Date | null;
  is_custom: boolean;
  created_by?: string | null;
}

interface UserRow {
  id: number;
  username: string;
  role: string;
  created_at: Date;
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

function toUserDto(row: UserRow) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    createdAt: row.created_at,
  };
}

router.get('/urls', async (req: Request, res: Response, next: NextFunction) => {
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

router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await pool.query(
      'SELECT id, github_id, username, role, created_at FROM users ORDER BY created_at DESC'
    );
    res.json((result.rows as UserRow[]).map(toUserDto));
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/users/:id/role',
  [
    body('role')
      .isIn(['user', 'privileged'])
      .withMessage("Role must be 'user' or 'privileged'"),
  ],
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { role } = req.body as { role: string };

      if (parseInt(String(id), 10) === (req.user as User).id) {
        return res.status(400).json({ error: 'You cannot change your own role.' });
      }

      const result = await pool.query(
        "UPDATE users SET role = $1 WHERE id = $2 AND role != 'admin' RETURNING id, username, role, created_at",
        [role, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found or is an admin whose role cannot be changed.' });
      }

      res.json(toUserDto(result.rows[0] as UserRow));
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/urls/:id', async (req: Request, res: Response, next: NextFunction) => {
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

export default router;
