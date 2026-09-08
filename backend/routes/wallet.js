const express = require('express');
const router = express.Router();
const pool = require('../db');

// GET /api/wallet/:customerId?shop_id=... -> balance + recent transaction history
router.get('/:customerId', async (req, res) => {
  const { customerId } = req.params;
  const { shop_id } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id is required' });

  try {
    const customer = await pool.query(
      `SELECT id, full_name, wallet_balance FROM customers WHERE id = $1 AND shop_id = $2`,
      [customerId, shop_id]
    );
    if (!customer.rows.length) return res.status(404).json({ error: 'Customer not found' });

    const history = await pool.query(
      `SELECT wt.id, wt.type, wt.amount, wt.balance_after, wt.notes, wt.created_at, u.full_name AS created_by_name
       FROM wallet_transactions wt
       LEFT JOIN users u ON u.id = wt.created_by
       WHERE wt.customer_id = $1
       ORDER BY wt.created_at DESC LIMIT 30`,
      [customerId]
    );

    res.json({
      customer_id: customer.rows[0].id,
      full_name: customer.rows[0].full_name,
      wallet_balance: Number(customer.rows[0].wallet_balance),
      history: history.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load wallet', detail: err.message });
  }
});

// POST /api/wallet/:customerId/topup
// body: { shop_id, amount, notes?, created_by? }
// Cash received now for future services. NOT counted as sales revenue —
// it's a liability until the customer actually redeems it for a service
// (which happens through POS with payment method "wallet").
router.post('/:customerId/topup', async (req, res) => {
  const { customerId } = req.params;
  const { shop_id, amount, notes, created_by } = req.body;
  if (!shop_id || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'shop_id and a positive amount are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updated = await client.query(
      `UPDATE customers SET wallet_balance = wallet_balance + $1
       WHERE id = $2 AND shop_id = $3 RETURNING wallet_balance`,
      [amount, customerId, shop_id]
    );
    if (!updated.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Customer not found' });
    }

    const newBalance = updated.rows[0].wallet_balance;
    await client.query(
      `INSERT INTO wallet_transactions (customer_id, shop_id, type, amount, balance_after, notes, created_by)
       VALUES ($1,$2,'topup',$3,$4,$5,$6)`,
      [customerId, shop_id, amount, newBalance, notes || null, created_by || null]
    );

    await client.query('COMMIT');
    res.status(201).json({ wallet_balance: Number(newBalance) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to top up wallet', detail: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
