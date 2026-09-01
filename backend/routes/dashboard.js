const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/dashboard/summary?shop_id=...
router.get('/summary', async (req, res) => {
  const { shop_id } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });

  try {
    const revenueToday = await pool.query(
      `SELECT COALESCE(SUM(total),0) AS total, COUNT(*) AS count
       FROM sales WHERE shop_id = $1 AND created_at::date = CURRENT_DATE`,
      [shop_id]
    );

    const revenueYesterday = await pool.query(
      `SELECT COALESCE(SUM(total),0) AS total
       FROM sales WHERE shop_id = $1 AND created_at::date = CURRENT_DATE - INTERVAL '1 day'`,
      [shop_id]
    );

    const customersToday = await pool.query(
      `SELECT COUNT(DISTINCT customer_id) AS count
       FROM sales WHERE shop_id = $1 AND created_at::date = CURRENT_DATE AND customer_id IS NOT NULL`,
      [shop_id]
    );

    const queueWaiting = await pool.query(
      `SELECT COUNT(*) AS count FROM queue_entries
       WHERE shop_id = $1 AND status IN ('waiting','called') AND joined_at::date = CURRENT_DATE`,
      [shop_id]
    );

    const lowStock = await pool.query(
      `SELECT id, name, stock_quantity, low_stock_threshold FROM products
       WHERE shop_id = $1 AND stock_quantity <= low_stock_threshold AND is_active = true
       ORDER BY stock_quantity ASC`,
      [shop_id]
    );

    const staffLeaderboard = await pool.query(
      `SELECT u.id, u.full_name, u.role, COUNT(s.id) AS services_count, COALESCE(SUM(s.total),0) AS revenue
       FROM barbers b
       JOIN users u ON u.id = b.id
       LEFT JOIN sales s ON s.barber_id = u.id AND s.shop_id = $1 AND s.created_at::date = CURRENT_DATE
       WHERE b.shop_id = $1 AND u.is_active = true
       GROUP BY u.id, u.full_name, u.role
       ORDER BY revenue DESC, services_count DESC, u.full_name ASC`,
      [shop_id]
    );

    const salesLast7Days = await pool.query(
      `SELECT created_at::date AS day, COALESCE(SUM(total),0) AS total
       FROM sales WHERE shop_id = $1 AND created_at >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY day ORDER BY day ASC`,
      [shop_id]
    );

    const todayTotal = Number(revenueToday.rows[0].total);
    const yesterdayTotal = Number(revenueYesterday.rows[0].total);
    const pctChange = yesterdayTotal > 0
      ? Math.round(((todayTotal - yesterdayTotal) / yesterdayTotal) * 100)
      : null;

    res.json({
      revenue_today: todayTotal,
      revenue_pct_change_vs_yesterday: pctChange,
      services_completed_today: Number(revenueToday.rows[0].count),
      customers_today: Number(customersToday.rows[0].count),
      queue_waiting: Number(queueWaiting.rows[0].count),
      low_stock: lowStock.rows,
      staff_leaderboard: staffLeaderboard.rows,
      sales_last_7_days: salesLast7Days.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load dashboard summary', detail: err.message });
  }
});

module.exports = router;
