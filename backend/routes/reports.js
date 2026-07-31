const express = require('express');
const router = express.Router();
const pool = require('../db');

function dateRange(req) {
  const from = req.query.from || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
  const to = req.query.to || new Date().toISOString().slice(0, 10);
  return { from, to };
}

// GET /api/reports/sales?shop_id=&from=&to=
router.get('/sales', async (req, res) => {
  const { shop_id } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });
  const { from, to } = dateRange(req);
  try {
    const daily = await pool.query(
      `SELECT created_at::date AS day, COUNT(*) AS sale_count, SUM(total) AS total
       FROM sales WHERE shop_id = $1 AND created_at::date BETWEEN $2 AND $3
       GROUP BY day ORDER BY day ASC`,
      [shop_id, from, to]
    );
    const totals = await pool.query(
      `SELECT COUNT(*) AS sale_count, COALESCE(SUM(total),0) AS total
       FROM sales WHERE shop_id = $1 AND created_at::date BETWEEN $2 AND $3`,
      [shop_id, from, to]
    );
    res.json({ from, to, daily: daily.rows, total: Number(totals.rows[0].total), sale_count: Number(totals.rows[0].sale_count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load sales report', detail: err.message });
  }
});

// GET /api/reports/services?shop_id=&from=&to= -> most popular services
router.get('/services', async (req, res) => {
  const { shop_id } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });
  const { from, to } = dateRange(req);
  try {
    const { rows } = await pool.query(
      `SELECT s.name, COUNT(*) AS times_sold, SUM(li.line_total) AS revenue
       FROM sale_line_items li
       JOIN services s ON s.id = li.service_id
       JOIN sales sa ON sa.id = li.sale_id
       WHERE sa.shop_id = $1 AND sa.created_at::date BETWEEN $2 AND $3 AND li.item_type = 'service'
       GROUP BY s.name ORDER BY times_sold DESC`,
      [shop_id, from, to]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load services report', detail: err.message });
  }
});

// GET /api/reports/commissions?shop_id=&from=&to=
router.get('/commissions', async (req, res) => {
  const { shop_id } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });
  const { from, to } = dateRange(req);
  try {
    const { rows } = await pool.query(
      `SELECT u.full_name, COUNT(*) AS sale_count, SUM(c.amount) AS commission_total
       FROM commissions c
       JOIN sales sa ON sa.id = c.sale_id
       JOIN users u ON u.id = c.barber_id
       WHERE sa.shop_id = $1 AND sa.created_at::date BETWEEN $2 AND $3
       GROUP BY u.full_name ORDER BY commission_total DESC`,
      [shop_id, from, to]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load commissions report', detail: err.message });
  }
});

// GET /api/reports/profit?shop_id=&from=&to= -> revenue - expenses - commissions
router.get('/profit', async (req, res) => {
  const { shop_id } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });
  const { from, to } = dateRange(req);
  try {
    const revenue = await pool.query(
      `SELECT COALESCE(SUM(total),0) AS total FROM sales WHERE shop_id = $1 AND created_at::date BETWEEN $2 AND $3`,
      [shop_id, from, to]
    );
    const expenses = await pool.query(
      `SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE shop_id = $1 AND incurred_at BETWEEN $2 AND $3`,
      [shop_id, from, to]
    );
    const commissions = await pool.query(
      `SELECT COALESCE(SUM(c.amount),0) AS total FROM commissions c JOIN sales sa ON sa.id = c.sale_id
       WHERE sa.shop_id = $1 AND sa.created_at::date BETWEEN $2 AND $3`,
      [shop_id, from, to]
    );
    const rev = Number(revenue.rows[0].total);
    const exp = Number(expenses.rows[0].total);
    const comm = Number(commissions.rows[0].total);
    res.json({ from, to, revenue: rev, expenses: exp, commissions: comm, profit: rev - exp - comm });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load profit report', detail: err.message });
  }
});

// GET /api/reports/customer-growth?shop_id=&from=&to=
router.get('/customer-growth', async (req, res) => {
  const { shop_id } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });
  const { from, to } = dateRange(req);
  try {
    const newCustomers = await pool.query(
      `SELECT COUNT(*) AS count FROM customers WHERE shop_id = $1 AND created_at::date BETWEEN $2 AND $3`,
      [shop_id, from, to]
    );
    const returning = await pool.query(
      `SELECT COUNT(DISTINCT customer_id) AS count FROM sales
       WHERE shop_id = $1 AND created_at::date BETWEEN $2 AND $3 AND customer_id IN (
         SELECT customer_id FROM sales WHERE shop_id = $1 AND created_at::date < $2 AND customer_id IS NOT NULL
       )`,
      [shop_id, from, to]
    );
    res.json({ from, to, new_customers: Number(newCustomers.rows[0].count), returning_customers: Number(returning.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load customer growth report', detail: err.message });
  }
});

module.exports = router;
