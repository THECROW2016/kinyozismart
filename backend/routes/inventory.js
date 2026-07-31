const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/inventory/products?shop_id=...  -> full product detail incl. cost, supplier
router.get('/products', async (req, res) => {
  const { shop_id } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.category, p.unit, p.cost_price, p.sell_price,
              p.stock_quantity, p.low_stock_threshold, s.name AS supplier_name
       FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.shop_id = $1 AND p.is_active = true
       ORDER BY p.name`,
      [shop_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load products', detail: err.message });
  }
});

// POST /api/inventory/products -> add a new product
router.post('/products', async (req, res) => {
  const { shop_id, name, category, cost_price, sell_price, stock_quantity, low_stock_threshold, supplier_id } = req.body;
  if (!shop_id || !name || sell_price === undefined) {
    return res.status(400).json({ error: 'shop_id, name, and sell_price are required' });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO products (shop_id, name, category, cost_price, sell_price, stock_quantity, low_stock_threshold, supplier_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [shop_id, name, category || null, cost_price || 0, sell_price, stock_quantity || 0, low_stock_threshold || 5, supplier_id || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add product', detail: err.message });
  }
});

// GET /api/inventory/suppliers?shop_id=...
router.get('/suppliers', async (req, res) => {
  const { shop_id } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });
  const { rows } = await pool.query(`SELECT id, name, phone, email FROM suppliers WHERE shop_id = $1 ORDER BY name`, [shop_id]);
  res.json(rows);
});

// POST /api/inventory/purchases -> record a stock purchase and increment stock
// body: { shop_id, supplier_id?, items: [{product_id, quantity, unit_cost}] }
router.post('/purchases', async (req, res) => {
  const { shop_id, supplier_id, items = [] } = req.body;
  if (!shop_id || items.length === 0) return res.status(400).json({ error: 'shop_id and at least one item are required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const totalCost = items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unit_cost), 0);

    const purchase = await client.query(
      `INSERT INTO purchases (shop_id, supplier_id, total_cost) VALUES ($1,$2,$3) RETURNING id`,
      [shop_id, supplier_id || null, totalCost]
    );

    for (const item of items) {
      await client.query(
        `INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost) VALUES ($1,$2,$3,$4)`,
        [purchase.rows[0].id, item.product_id, item.quantity, item.unit_cost]
      );
      await client.query(
        `UPDATE products SET stock_quantity = stock_quantity + $2 WHERE id = $1`,
        [item.product_id, item.quantity]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ id: purchase.rows[0].id, total_cost: totalCost });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to record purchase', detail: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
