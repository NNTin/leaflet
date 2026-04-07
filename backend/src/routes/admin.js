const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// All admin routes require authentication and admin role
router.use(requireAuth, requireAdmin);

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

/** Convert snake_case user row to camelCase for API responses */
function toUserDto(row) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    createdAt: row.created_at,
  };
}

// GET /admin/urls - list all URLs (admin only, camelCase response)
router.get('/urls', async (req, res, next) => {
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

// GET /admin/users - list all users
router.get('/users', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, github_id, username, role, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows.map(toUserDto));
  } catch (err) {
    next(err);
  }
});

// PATCH /admin/users/:id/role - update a user's role (to 'user' or 'privileged')
router.patch(
  '/users/:id/role',
  [
    body('role')
      .isIn(['user', 'privileged'])
      .withMessage("Role must be 'user' or 'privileged'"),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { id } = req.params;
      const { role } = req.body;

      // Prevent admins from demoting themselves
      if (parseInt(id, 10) === req.user.id) {
        return res.status(400).json({ error: 'You cannot change your own role.' });
      }

      const result = await pool.query(
        "UPDATE users SET role = $1 WHERE id = $2 AND role != 'admin' RETURNING id, username, role, created_at",
        [role, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found or is an admin whose role cannot be changed.' });
      }

      res.json(toUserDto(result.rows[0]));
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /admin/urls/:id - delete any URL by numeric ID
router.delete('/urls/:id', async (req, res, next) => {
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

module.exports = router;
