const express = require('express');
const router = express.Router();
const pool = require('../db');

router.get('/services', async (req, res) => {
  const { shop_id } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });
  const { rows } = await pool.query(
    `SELECT id, name, price, duration_mins FROM services WHERE shop_id = $1 AND is_active = true ORDER BY name`,
    [shop_id]
  );
  res.json(rows);
});

router.get('/products', async (req, res) => {
  const { shop_id } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });
  const { rows } = await pool.query(
    `SELECT id, name, sell_price, stock_quantity, low_stock_threshold FROM products
     WHERE shop_id = $1 AND is_active = true ORDER BY name`,
    [shop_id]
  );
  res.json(rows);
});

router.get('/barbers', async (req, res) => {
  const { shop_id } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });
  const { rows } = await pool.query(
    `SELECT b.id, u.full_name, b.specialties, b.commission_rate, b.is_available, b.rating_avg
     FROM barbers b JOIN users u ON u.id = b.id
     WHERE b.shop_id = $1 ORDER BY u.full_name`,
    [shop_id]
  );
  res.json(rows);
});

router.get('/customers', async (req, res) => {
  const { shop_id, search } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });
  const params = [shop_id];
  let sql = `SELECT id, full_name, phone, loyalty_points FROM customers WHERE shop_id = $1`;
  if (search) {
    params.push(`%${search}%`);
    sql += ` AND (full_name ILIKE $2 OR phone ILIKE $2)`;
  }
  sql += ` ORDER BY full_name LIMIT 25`;
  const { rows } = await pool.query(sql, params);
  res.json(rows);
});

router.get('/customers/:id', async (req, res) => {
  const { id } = req.params;
  const customer = await pool.query(`SELECT id, full_name, phone, loyalty_points, created_at FROM customers WHERE id = $1`, [id]);
  if (!customer.rows.length) return res.status(404).json({ error: 'Customer not found' });

  const visits = await pool.query(
    `SELECT s.id, s.created_at, s.total, u.full_name AS barber_name,
            COALESCE(json_agg(sv.name) FILTER (WHERE li.item_type = 'service'), '[]') AS services
     FROM sales s
     LEFT JOIN users u ON u.id = s.barber_id
     LEFT JOIN sale_line_items li ON li.sale_id = s.id
     LEFT JOIN services sv ON sv.id = li.service_id
     WHERE s.customer_id = $1
     GROUP BY s.id, u.full_name
     ORDER BY s.created_at DESC LIMIT 20`,
    [id]
  );

  res.json({ ...customer.rows[0], visits: visits.rows });
});

module.exports = router;
