const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyPin } = require('../utils/pin');

// GET /api/auth/staff?shop_id=...&group=admin|manager
// The app has exactly two account types: admin (owner — sees and manages
// everything) and manager (runs day-to-day operations, can add but not delete).
router.get('/staff', async (req, res) => {
  const { shop_id, group } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });

  const roles = group === 'admin' ? ['owner']
    : group === 'manager' ? ['manager']
    : ['owner', 'manager'];

  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, role FROM users
       WHERE shop_id = $1 AND role = ANY($2) AND is_active = true
       ORDER BY full_name`,
      [shop_id, roles]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load staff list', detail: err.message });
  }
});

// POST /api/auth/login  body: { user_id, pin }
router.post('/login', async (req, res) => {
  const { user_id, pin } = req.body;
  if (!user_id || !pin) return res.status(400).json({ error: 'user_id and pin are required' });

  try {
    const { rows } = await pool.query(
      `SELECT id, full_name, role, pin_hash FROM users WHERE id = $1 AND is_active = true`,
      [user_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    const user = rows[0];
    if (!verifyPin(pin, user.pin_hash)) {
      return res.status(401).json({ error: 'Incorrect PIN' });
    }

    res.json({ id: user.id, full_name: user.full_name, role: user.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed', detail: err.message });
  }
});

module.exports = router;
