const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/staff?shop_id=... -> barbers with today's performance and clock-in status
router.get('/', async (req, res) => {
  const { shop_id } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });

  try {
    const { rows } = await pool.query(
      `SELECT
         b.id, u.full_name, u.phone, b.specialties, b.commission_type, b.commission_rate,
         b.is_available, b.rating_avg,
         COALESCE(perf.services_count, 0) AS services_today,
         COALESCE(perf.revenue_today, 0) AS revenue_today,
         COALESCE(comm.commission_today, 0) AS commission_today,
         att.clock_in, att.clock_out
       FROM barbers b
       JOIN users u ON u.id = b.id
       LEFT JOIN (
         SELECT barber_id, COUNT(*) AS services_count, SUM(total) AS revenue_today
         FROM sales WHERE shop_id = $1 AND created_at::date = CURRENT_DATE
         GROUP BY barber_id
       ) perf ON perf.barber_id = b.id
       LEFT JOIN (
         SELECT c.barber_id, SUM(c.amount) AS commission_today
         FROM commissions c JOIN sales s ON s.id = c.sale_id
         WHERE s.shop_id = $1 AND s.created_at::date = CURRENT_DATE
         GROUP BY c.barber_id
       ) comm ON comm.barber_id = b.id
       LEFT JOIN LATERAL (
         SELECT clock_in, clock_out FROM attendance
         WHERE barber_id = b.id AND clock_in::date = CURRENT_DATE
         ORDER BY clock_in DESC LIMIT 1
       ) att ON true
       WHERE b.shop_id = $1
       ORDER BY revenue_today DESC NULLS LAST, u.full_name`,
      [shop_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load staff', detail: err.message });
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

module.exports = router;
