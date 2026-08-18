const express = require('express');
const router = express.Router();
const pool = require('../db');
const { verifyPin } = require('../utils/pin');

// In-memory lockout tracking per user_id. Resets on server restart — fine at
// this scale, and combined with the IP-based rate limiter on this route.
const failedAttempts = new Map(); // user_id -> { count, lockedUntil }
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

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

  const attempt = failedAttempts.get(user_id);
  if (attempt && attempt.lockedUntil && attempt.lockedUntil > Date.now()) {
    const minutesLeft = Math.ceil((attempt.lockedUntil - Date.now()) / 60000);
    return res.status(429).json({ error: `Too many failed attempts. Try again in ${minutesLeft} minute(s).` });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, shop_id, full_name, role, pin_hash FROM users WHERE id = $1 AND is_active = true`,
      [user_id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found' });

    const user = rows[0];
    if (!verifyPin(pin, user.pin_hash)) {
      const current = failedAttempts.get(user_id) || { count: 0 };
      current.count += 1;
      if (current.count >= MAX_ATTEMPTS) {
        current.lockedUntil = Date.now() + LOCKOUT_MS;
        current.count = 0;
      }
      failedAttempts.set(user_id, current);
      return res.status(401).json({ error: 'Incorrect PIN' });
    }

    failedAttempts.delete(user_id);

    const session = await pool.query(
      `INSERT INTO login_sessions (user_id, shop_id) VALUES ($1, $2) RETURNING id, login_at`,
      [user.id, user.shop_id]
    );

    res.json({
      id: user.id,
      full_name: user.full_name,
      role: user.role,
      session_id: session.rows[0].id
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed', detail: err.message });
  }
});

// POST /api/auth/logout  body: { session_id }
router.post('/logout', async (req, res) => {
  const { session_id } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id is required' });
  try {
    const { rows } = await pool.query(
      `UPDATE login_sessions SET logout_at = now() WHERE id = $1 AND logout_at IS NULL RETURNING id`,
      [session_id]
    );
    res.json({ loggedOut: rows.length > 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Logout failed', detail: err.message });
  }
});

// GET /api/auth/sessions?shop_id=...&limit=25 — login/logout audit trail
router.get('/sessions', async (req, res) => {
  const { shop_id } = req.query;
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });

  try {
    const { rows } = await pool.query(
      `SELECT ls.id, ls.login_at, ls.logout_at, u.full_name, u.role
       FROM login_sessions ls
       JOIN users u ON u.id = ls.user_id
       WHERE ls.shop_id = $1
       ORDER BY ls.login_at DESC
       LIMIT $2`,
      [shop_id, limit]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load login history', detail: err.message });
  }
});

module.exports = router;
