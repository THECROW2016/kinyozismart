const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/queue?shop_id=...  -> today's queue, grouped by status
router.get('/', async (req, res) => {
  const { shop_id } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });

  try {
    const { rows } = await pool.query(
      `SELECT
         q.id, q.queue_number, q.customer_name_snapshot AS customer_name,
         q.status, q.joined_at, q.called_at, q.started_at,
         b.id AS barber_id, u.full_name AS barber_name,
         COALESCE(
           json_agg(s.name) FILTER (WHERE s.name IS NOT NULL), '[]'
         ) AS services
       FROM queue_entries q
       LEFT JOIN barbers b ON b.id = q.barber_id
       LEFT JOIN users u ON u.id = b.id
       LEFT JOIN queue_entry_services qes ON qes.queue_entry_id = q.id
       LEFT JOIN services s ON s.id = qes.service_id
       WHERE q.shop_id = $1 AND q.joined_at::date = CURRENT_DATE
         AND q.status IN ('waiting','called','in_service')
       GROUP BY q.id, b.id, u.full_name
       ORDER BY q.queue_number ASC`,
      [shop_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load queue', detail: err.message });
  }
});

// POST /api/queue  -> add a walk-in
// body: { shop_id, customer_name, phone, service_ids: [uuid], barber_id? }
router.post('/', async (req, res) => {
  const { shop_id, customer_name, phone, service_ids = [], barber_id } = req.body;
  if (!shop_id || !customer_name) {
    return res.status(400).json({ error: 'shop_id and customer_name are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    let customerId = null;
    if (phone) {
      const existing = await client.query(
        `SELECT id FROM customers WHERE shop_id = $1 AND phone = $2`, [shop_id, phone]
      );
      if (existing.rows.length) {
        customerId = existing.rows[0].id;
      } else {
        const created = await client.query(
          `INSERT INTO customers (shop_id, full_name, phone) VALUES ($1,$2,$3) RETURNING id`,
          [shop_id, customer_name, phone]
        );
        customerId = created.rows[0].id;
      }
    }

    const countResult = await client.query(
      `SELECT COUNT(*) AS count FROM queue_entries WHERE shop_id = $1 AND joined_at::date = CURRENT_DATE`,
      [shop_id]
    );
    const queueNumber = Number(countResult.rows[0].count) + 1;

    const entry = await client.query(
      `INSERT INTO queue_entries (shop_id, queue_number, customer_id, customer_name_snapshot, barber_id, status)
       VALUES ($1,$2,$3,$4,$5,'waiting') RETURNING id, queue_number`,
      [shop_id, queueNumber, customerId, customer_name, barber_id || null]
    );

    for (const serviceId of service_ids) {
      await client.query(
        `INSERT INTO queue_entry_services (queue_entry_id, service_id) VALUES ($1,$2)`,
        [entry.rows[0].id, serviceId]
      );
    }

    await client.query('COMMIT');
    res.status(201).json(entry.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to add walk-in', detail: err.message });
  } finally {
    client.release();
  }
});

// PATCH /api/queue/:id/call  -> assign barber (optional) and mark called
router.patch('/:id/call', async (req, res) => {
  const { id } = req.params;
  const { barber_id } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE queue_entries SET status = 'called', called_at = now(), barber_id = COALESCE($2, barber_id)
       WHERE id = $1 RETURNING *`,
      [id, barber_id || null]
    );
    if (!rows.length) return res.status(404).json({ error: 'Queue entry not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to call customer', detail: err.message });
  }
});

// PATCH /api/queue/:id/start  -> mark in_service
router.patch('/:id/start', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `UPDATE queue_entries SET status = 'in_service', started_at = now() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Queue entry not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to start service', detail: err.message });
  }
});

// PATCH /api/queue/:id/complete  -> mark completed (called after a sale is recorded)
router.patch('/:id/complete', async (req, res) => {
  const { id } = req.params;
  const { sale_id } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE queue_entries SET status = 'completed', completed_at = now(), sale_id = $2 WHERE id = $1 RETURNING *`,
      [id, sale_id || null]
    );
    if (!rows.length) return res.status(404).json({ error: 'Queue entry not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to complete queue entry', detail: err.message });
  }
});

module.exports = router;
