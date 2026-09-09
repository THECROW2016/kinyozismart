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

// GET /api/reports/export?shop_id=&from=&to= -> row-level sales/expenses/commissions
// for the Reports page's data export (CSV / printable report), as opposed to
// the aggregated endpoints above which only feed on-screen charts/summaries.
router.get('/export', async (req, res) => {
  const { shop_id } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });
  const { from, to } = dateRange(req);
  try {
    const sales = await pool.query(
      `SELECT
         sa.created_at,
         COALESCE(cu.full_name, 'Walk-in') AS customer_name,
         bu.full_name AS barber_name,
         COALESCE(item_agg.items, '') AS items,
         sa.subtotal, sa.total,
         COALESCE(pay_agg.methods, '') AS payment_methods,
         ru.full_name AS rung_up_by
       FROM sales sa
       LEFT JOIN customers cu ON cu.id = sa.customer_id
       JOIN barbers br ON br.id = sa.barber_id
       JOIN users bu ON bu.id = br.id
       JOIN users ru ON ru.id = sa.created_by
       LEFT JOIN LATERAL (
         SELECT string_agg(
           (CASE WHEN li.item_type = 'service' THEN s.name ELSE p.name END) || ' x' || li.quantity,
           '; ' ORDER BY li.id
         ) AS items
         FROM sale_line_items li
         LEFT JOIN services s ON s.id = li.service_id
         LEFT JOIN products p ON p.id = li.product_id
         WHERE li.sale_id = sa.id
       ) item_agg ON true
       LEFT JOIN LATERAL (
         SELECT string_agg(DISTINCT sp.method::text, ', ') AS methods
         FROM sale_payments sp WHERE sp.sale_id = sa.id
       ) pay_agg ON true
       WHERE sa.shop_id = $1 AND sa.created_at::date BETWEEN $2 AND $3
       ORDER BY sa.created_at ASC`,
      [shop_id, from, to]
    );

    const expenses = await pool.query(
      `SELECT e.incurred_at, e.category, COALESCE(e.description, '') AS description,
              e.amount, u.full_name AS recorded_by
       FROM expenses e
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.shop_id = $1 AND e.incurred_at BETWEEN $2 AND $3
       ORDER BY e.incurred_at ASC`,
      [shop_id, from, to]
    );

    const commissions = await pool.query(
      `SELECT sa.created_at, u.full_name AS barber_name, sa.total AS sale_total,
              c.amount, c.is_paid_out
       FROM commissions c
       JOIN sales sa ON sa.id = c.sale_id
       JOIN users u ON u.id = c.barber_id
       WHERE sa.shop_id = $1 AND sa.created_at::date BETWEEN $2 AND $3
       ORDER BY sa.created_at ASC`,
      [shop_id, from, to]
    );

    res.json({ from, to, sales: sales.rows, expenses: expenses.rows, commissions: commissions.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to build export', detail: err.message });
  }
});

// GET /api/reports/attendance?shop_id=&from=&to=
// Check-in/check-out records for every barber/beautician in the range, plus
// hours worked per record and a per-staff total for the period.
router.get('/attendance', async (req, res) => {
  const { shop_id } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });
  const { from, to } = dateRange(req);

  try {
    const records = await pool.query(
      `SELECT u.full_name, u.role, a.clock_in, a.clock_out,
              EXTRACT(EPOCH FROM (COALESCE(a.clock_out, now()) - a.clock_in)) / 3600 AS hours
       FROM attendance a
       JOIN users u ON u.id = a.barber_id
       WHERE a.shop_id = $1 AND a.clock_in::date BETWEEN $2 AND $3
       ORDER BY a.clock_in ASC`,
      [shop_id, from, to]
    );

    const totalsMap = {};
    for (const r of records.rows) {
      const key = r.full_name;
      totalsMap[key] = (totalsMap[key] || 0) + Number(r.hours);
    }
    const totals = Object.entries(totalsMap).map(([full_name, hours]) => ({ full_name, hours }))
      .sort((a, b) => b.hours - a.hours);

    res.json({ from, to, records: records.rows, totals });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to build attendance report', detail: err.message });
  }
});

module.exports = router;
