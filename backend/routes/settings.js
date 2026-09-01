const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/settings/shop?shop_id=...
router.get('/shop', async (req, res) => {
  const { shop_id } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });
  const { rows } = await pool.query(`SELECT * FROM shops WHERE id = $1`, [shop_id]);
  if (!rows.length) return res.status(404).json({ error: 'Shop not found' });
  res.json(rows[0]);
});

// PATCH /api/settings/shop/:id
router.patch('/shop/:id', async (req, res) => {
  const { id } = req.params;
  let { name, location, phone, opening_time, closing_time, mpesa_till, mpesa_paybill, receipt_footer } = req.body;
  // Empty strings from HTML inputs aren't valid for TIME columns and shouldn't
  // be treated as "clear this field" — normalize to null so COALESCE keeps
  // the existing value instead of erroring.
  if (opening_time === '') opening_time = null;
  if (closing_time === '') closing_time = null;

  try {
    const { rows } = await pool.query(
      `UPDATE shops SET
         name = COALESCE($2, name),
         location = COALESCE($3, location),
         phone = COALESCE($4, phone),
         opening_time = COALESCE($5, opening_time),
         closing_time = COALESCE($6, closing_time),
         mpesa_till = COALESCE($7, mpesa_till),
         mpesa_paybill = COALESCE($8, mpesa_paybill),
         receipt_footer = COALESCE($9, receipt_footer)
       WHERE id = $1 RETURNING *`,
      [id, name, location, phone, opening_time, closing_time, mpesa_till, mpesa_paybill, receipt_footer]
    );
    if (!rows.length) return res.status(404).json({ error: 'Shop not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update shop', detail: err.message });
  }
});

// POST /api/settings/services -> add a new service to the price list
router.post('/services', async (req, res) => {
  const { shop_id, name, category, price, duration_mins } = req.body;
  if (!shop_id || !name || price === undefined) {
    return res.status(400).json({ error: 'shop_id, name, and price are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO services (shop_id, name, category, price, duration_mins) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [shop_id, name, category || null, price, duration_mins || 30]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add service', detail: err.message });
  }
});

// PATCH /api/settings/services/:id -> edit price / active state / category
router.patch('/services/:id', async (req, res) => {
  const { id } = req.params;
  const { price, is_active, name, category, duration_mins } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE services SET
         price = COALESCE($2, price),
         is_active = COALESCE($3, is_active),
         name = COALESCE($4, name),
         category = COALESCE($5, category),
         duration_mins = COALESCE($6, duration_mins)
       WHERE id = $1 RETURNING *`,
      [id, price, is_active, name, category, duration_mins]
    );
    if (!rows.length) return res.status(404).json({ error: 'Service not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update service', detail: err.message });
  }
});

module.exports = router;
