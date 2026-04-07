const express = require('express');
const { body, validationResult } = require('express-validator');
const router = express.Router();
const pool = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

// All admin routes require authentication and admin role
router.use(requireAuth, requireAdmin);

// GET /admin/users - list all users
router.get('/users', async (req, res) => {
  const result = await pool.query(
    'SELECT id, github_id, username, role, created_at FROM users ORDER BY created_at DESC'
  );
  res.json(result.rows);
});

// PATCH /admin/users/:id/role - update a user's role (to 'user' or 'privileged')
router.patch(
  '/users/:id/role',
  [
    body('role')
      .isIn(['user', 'privileged'])
      .withMessage("Role must be 'user' or 'privileged'"),
  ],
  async (req, res) => {
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
      "UPDATE users SET role = $1 WHERE id = $2 AND role != 'admin' RETURNING id, username, role",
      [role, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or is an admin whose role cannot be changed.' });
    }

    res.json(result.rows[0]);
  }
);

// DELETE /admin/urls/:id - delete any URL
router.delete('/urls/:id', async (req, res) => {
  const { id } = req.params;
  const result = await pool.query('DELETE FROM urls WHERE id = $1 RETURNING id', [id]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'URL not found.' });
  }
  res.json({ message: 'URL deleted successfully.' });
});

module.exports = router;
