const express = require('express');
const router = express.Router();
const pool = require('../db');
const { hashPin } = require('../utils/pin');

// GET /api/staff?shop_id=... -> all staff (any role), with barber-specific
// performance/commission/attendance data where applicable
router.get('/', async (req, res) => {
  const { shop_id } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });

  try {
    const { rows } = await pool.query(
      `SELECT
         u.id, u.full_name, u.phone, u.role, u.photo_url, u.is_active,
         b.specialties, b.commission_type, b.commission_rate, b.is_available,
         COALESCE(perf.services_count, 0) AS services_today,
         COALESCE(perf.revenue_today, 0) AS revenue_today,
         COALESCE(comm.commission_today, 0) AS commission_today,
         COALESCE(lifetime.total_services, 0) AS total_services,
         FLOOR(COALESCE(lifetime.total_services, 0) / 50.0) * 0.5 AS rating_avg,
         att.clock_in, att.clock_out
       FROM users u
       LEFT JOIN barbers b ON b.id = u.id
       LEFT JOIN (
         SELECT barber_id, COUNT(*) AS services_count, SUM(total) AS revenue_today
         FROM sales WHERE shop_id = $1 AND created_at::date = CURRENT_DATE
         GROUP BY barber_id
       ) perf ON perf.barber_id = u.id
       LEFT JOIN (
         SELECT c.barber_id, SUM(c.amount) AS commission_today
         FROM commissions c JOIN sales s ON s.id = c.sale_id
         WHERE s.shop_id = $1 AND s.created_at::date = CURRENT_DATE
         GROUP BY c.barber_id
       ) comm ON comm.barber_id = u.id
       LEFT JOIN (
         -- Lifetime count of individual services performed (not sale/transaction
         -- count — one sale can include several services). Rating is earned
         -- automatically: +0.5 stars for every 50 services completed.
         SELECT s.barber_id, COUNT(*) AS total_services
         FROM sale_line_items li
         JOIN sales s ON s.id = li.sale_id
         WHERE li.item_type = 'service' AND s.shop_id = $1
         GROUP BY s.barber_id
       ) lifetime ON lifetime.barber_id = u.id
       LEFT JOIN LATERAL (
         SELECT clock_in, clock_out FROM attendance
         WHERE barber_id = u.id AND clock_in::date = CURRENT_DATE
         ORDER BY clock_in DESC LIMIT 1
       ) att ON true
       WHERE u.shop_id = $1 AND u.role != 'owner' AND u.is_active = true
       ORDER BY revenue_today DESC NULLS LAST, u.full_name`,
      [shop_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load staff', detail: err.message });
  }
});

// POST /api/staff -> register a new staff member (barber, beautician,
// receptionist, manager, or secretary)
// Manager and secretary accounts log into the app, so a PIN is required for
// those roles. Barbers, beauticians, and receptionists remain records-only.
// body: { shop_id, full_name, phone, role, pin?, photo_url?, specialties?: string[], commission_rate? }
router.post('/', async (req, res) => {
  const { shop_id, full_name, phone, role, pin, photo_url, specialties, commission_rate } = req.body;
  const allowedRoles = ['barber', 'beautician', 'receptionist', 'manager', 'secretary'];
  const loginRoles = ['manager', 'secretary'];
  const providerRoles = ['barber', 'beautician']; // get a row in the barbers table (performance/commission tracking)
  if (!shop_id || !full_name || !phone || !role) {
    return res.status(400).json({ error: 'shop_id, full_name, phone, and role are required' });
  }
  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ error: `role must be one of ${allowedRoles.join(', ')}` });
  }
  if (loginRoles.includes(role) && !/^\d{4}$/.test(String(pin))) {
    return res.status(400).json({ error: 'A 4-digit login PIN is required for manager and secretary accounts' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const user = await client.query(
      `INSERT INTO users (shop_id, full_name, phone, password_hash, pin_hash, role, photo_url)
       VALUES ($1,$2,$3,'',$4,$5,$6) RETURNING id, full_name, phone, role, photo_url`,
      [shop_id, full_name, phone, loginRoles.includes(role) ? hashPin(pin) : null, role, photo_url || null]
    );

    if (providerRoles.includes(role)) {
      await client.query(
        `INSERT INTO barbers (id, shop_id, specialties, commission_rate)
         VALUES ($1,$2,$3,$4)`,
        [user.rows[0].id, shop_id, specialties && specialties.length ? specialties : null, commission_rate || 40]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(user.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    if (err.code === '23505') { // unique_violation on (shop_id, phone)
      return res.status(409).json({ error: 'A staff member with this phone number already exists' });
    }
    res.status(500).json({ error: 'Failed to register staff', detail: err.message });
  } finally {
    client.release();
  }
});

// PATCH /api/staff/:id -> edit staff details (name, phone, photo, commission)
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const { full_name, phone, photo_url, commission_rate, specialties, is_active } = req.body;
  try {
    const userUpdate = await pool.query(
      `UPDATE users SET
         full_name = COALESCE($2, full_name),
         phone = COALESCE($3, phone),
         photo_url = COALESCE($4, photo_url),
         is_active = COALESCE($5, is_active)
       WHERE id = $1 RETURNING id, full_name, phone, role, photo_url`,
      [id, full_name, phone, photo_url, is_active]
    );
    if (!userUpdate.rows.length) return res.status(404).json({ error: 'Staff member not found' });

    if (commission_rate !== undefined || specialties !== undefined) {
      await pool.query(
        `UPDATE barbers SET
           commission_rate = COALESCE($2, commission_rate),
           specialties = COALESCE($3, specialties)
         WHERE id = $1`,
        [id, commission_rate, specialties]
      );
    }

    res.json(userUpdate.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update staff', detail: err.message });
  }
});

// POST /api/staff/:id/clock-in
router.post('/:id/clock-in', async (req, res) => {
  const { id } = req.params;
  const { shop_id } = req.body;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO attendance (barber_id, shop_id, clock_in) VALUES ($1,$2, now()) RETURNING *`,
      [id, shop_id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to clock in', detail: err.message });
  }
});

// POST /api/staff/:id/clock-out
router.post('/:id/clock-out', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `UPDATE attendance SET clock_out = now()
       WHERE barber_id = $1 AND clock_in::date = CURRENT_DATE AND clock_out IS NULL
       RETURNING *`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'No open clock-in found for today' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to clock out', detail: err.message });
  }
});

// DELETE /api/staff/:id -> soft delete (deactivate). Staff with sales/commission
// history can't be hard-deleted without breaking that history, so this removes
// them from the active roster instead of destroying records.
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `UPDATE users SET is_active = false WHERE id = $1 AND role != 'owner' RETURNING id, full_name`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Staff member not found (or cannot remove the owner account)' });
    res.json({ deleted: true, id: rows[0].id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove staff member', detail: err.message });
  }
});

module.exports = router;
