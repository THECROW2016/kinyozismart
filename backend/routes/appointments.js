const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/appointments?shop_id=...&date=YYYY-MM-DD (defaults to today)
router.get('/', async (req, res) => {
  const { shop_id, date } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });
  const targetDate = date || new Date().toISOString().slice(0, 10);

  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.scheduled_at, a.status, a.notes, a.source,
              c.full_name AS customer_name, c.phone AS customer_phone,
              u.full_name AS barber_name, a.barber_id,
              COALESCE(json_agg(s.name) FILTER (WHERE s.name IS NOT NULL), '[]') AS services
       FROM appointments a
       JOIN customers c ON c.id = a.customer_id
       LEFT JOIN barbers b ON b.id = a.barber_id
       LEFT JOIN users u ON u.id = b.id
       LEFT JOIN appointment_services aps ON aps.appointment_id = a.id
       LEFT JOIN services s ON s.id = aps.service_id
       WHERE a.shop_id = $1 AND a.scheduled_at::date = $2
       GROUP BY a.id, c.full_name, c.phone, u.full_name
       ORDER BY a.scheduled_at ASC`,
      [shop_id, targetDate]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load appointments', detail: err.message });
  }
});

// POST /api/appointments
// body: { shop_id, customer_name, phone, barber_id, scheduled_at, service_ids: [], notes? }
router.post('/', async (req, res) => {
  const { shop_id, customer_name, phone, barber_id, scheduled_at, service_ids = [], notes } = req.body;
  if (!shop_id || !customer_name || !scheduled_at) {
    return res.status(400).json({ error: 'shop_id, customer_name, and scheduled_at are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let customerId = null;
    if (phone) {
      const existing = await client.query(`SELECT id FROM customers WHERE shop_id = $1 AND phone = $2`, [shop_id, phone]);
      customerId = existing.rows.length ? existing.rows[0].id : null;
    }
    if (!customerId) {
      const created = await client.query(
        `INSERT INTO customers (shop_id, full_name, phone) VALUES ($1,$2,$3) RETURNING id`,
        [shop_id, customer_name, phone || null]
      );
      customerId = created.rows[0].id;
    }

    const appt = await client.query(
      `INSERT INTO appointments (shop_id, customer_id, barber_id, scheduled_at, notes, source)
       VALUES ($1,$2,$3,$4,$5,'walk_in_desk') RETURNING id`,
      [shop_id, customerId, barber_id || null, scheduled_at, notes || null]
    );

    for (const serviceId of service_ids) {
      await client.query(
        `INSERT INTO appointment_services (appointment_id, service_id) VALUES ($1,$2)`,
        [appt.rows[0].id, serviceId]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ id: appt.rows[0].id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to create appointment', detail: err.message });
  } finally {
    client.release();
  }
});

// PATCH /api/appointments/:id/status
router.patch('/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  const allowed = ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show'];
  if (!allowed.includes(status)) return res.status(400).json({ error: `status must be one of ${allowed.join(', ')}` });

  try {
    const { rows } = await pool.query(`UPDATE appointments SET status = $2 WHERE id = $1 RETURNING *`, [id, status]);
    if (!rows.length) return res.status(404).json({ error: 'Appointment not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update appointment', detail: err.message });
  }
});

// DELETE /api/appointments/:id
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(`DELETE FROM appointments WHERE id = $1 RETURNING id`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Appointment not found' });
    res.json({ deleted: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete appointment', detail: err.message });
  }
});

module.exports = router;
