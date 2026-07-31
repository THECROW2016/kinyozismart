const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/expenses?shop_id=...&from=&to=
router.get('/', async (req, res) => {
  const { shop_id, from, to } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });
  const fromDate = from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const toDate = to || new Date().toISOString().slice(0, 10);

  try {
    const { rows } = await pool.query(
      `SELECT id, category, description, amount, incurred_at
       FROM expenses WHERE shop_id = $1 AND incurred_at BETWEEN $2 AND $3
       ORDER BY incurred_at DESC`,
      [shop_id, fromDate, toDate]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load expenses', detail: err.message });
  }
});

// POST /api/expenses
router.post('/', async (req, res) => {
  const { shop_id, category, description, amount, incurred_at, created_by } = req.body;
  if (!shop_id || !category || amount === undefined) {
    return res.status(400).json({ error: 'shop_id, category, and amount are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO expenses (shop_id, category, description, amount, incurred_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [shop_id, category, description || null, amount, incurred_at || new Date().toISOString().slice(0, 10), created_by || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add expense', detail: err.message });
  }
});

module.exports = router;
