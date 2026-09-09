const express = require('express');
const router = express.Router();
const pool = require('../db');

// POST /api/sales -> record a full POS transaction
// body: {
//   shop_id, customer_id?, barber_id, queue_entry_id?, created_by,
//   services: [{service_id, price}], products: [{product_id, quantity, price}],
//   discount_type?, discount_value?, discount_reason?,
//   payment: { method, amount }
// }
router.post('/', async (req, res) => {
  const {
    shop_id, customer_id, barber_id, queue_entry_id, created_by,
    services = [], products = [],
    discount_type, discount_value = 0, discount_reason,
    payment
  } = req.body;

  if (!shop_id || !barber_id || !created_by || !payment) {
    return res.status(400).json({ error: 'shop_id, barber_id, created_by, and payment are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const serviceTotal = services.reduce((sum, s) => sum + Number(s.price), 0);
    const productTotal = products.reduce((sum, p) => sum + Number(p.price) * Number(p.quantity), 0);
    const subtotal = serviceTotal + productTotal;
    const discountAmount = discount_type === 'percentage'
      ? subtotal * (Number(discount_value) / 100)
      : Number(discount_value || 0);
    const total = Math.round(Math.max(subtotal - discountAmount, 0) * 100) / 100;

    const sale = await client.query(
      `INSERT INTO sales (shop_id, customer_id, barber_id, queue_entry_id, subtotal, discount_type, discount_value, discount_reason, total, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [shop_id, customer_id || null, barber_id, queue_entry_id || null, subtotal,
       discount_type || null, discount_value || 0, discount_reason || null, total, created_by]
    );
    const saleId = sale.rows[0].id;

    for (const s of services) {
      await client.query(
        `INSERT INTO sale_line_items (sale_id, item_type, service_id, quantity, unit_price, line_total)
         VALUES ($1,'service',$2,1,$3,$3)`,
        [saleId, s.service_id, s.price]
      );
    }

    for (const p of products) {
      const lineTotal = Number(p.price) * Number(p.quantity);
      await client.query(
        `INSERT INTO sale_line_items (sale_id, item_type, product_id, quantity, unit_price, line_total)
         VALUES ($1,'product',$2,$3,$4,$5)`,
        [saleId, p.product_id, p.quantity, p.price, lineTotal]
      );
      // decrement stock
      await client.query(
        `UPDATE products SET stock_quantity = GREATEST(stock_quantity - $2, 0) WHERE id = $1`,
        [p.product_id, p.quantity]
      );
    }

    // Wallet payments draw down a customer's prepaid balance instead of
    // taking new cash/mpesa/card — verify and deduct atomically here so a
    // customer can never be charged more than they've actually deposited.
    // Critically, this uses `total` (computed above from the actual
    // services/products/discount) rather than the client-supplied
    // payment.amount — the wallet must never be charged a different amount
    // than what the sale record itself says was owed.
    if (payment.method === 'wallet') {
      if (!customer_id) {
        throw Object.assign(new Error('Wallet payment requires a customer to be selected'), { statusCode: 400 });
      }
      const custRow = await client.query(
        `SELECT wallet_balance FROM customers WHERE id = $1 AND shop_id = $2 FOR UPDATE`,
        [customer_id, shop_id]
      );
      if (!custRow.rows.length) {
        throw Object.assign(new Error('Customer not found'), { statusCode: 404 });
      }
      const currentBalance = Number(custRow.rows[0].wallet_balance);
      if (currentBalance < total) {
        throw Object.assign(
          new Error(`Insufficient wallet balance: has KSh ${currentBalance.toLocaleString()}, needs KSh ${total.toLocaleString()}`),
          { statusCode: 400 }
        );
      }
      const newBalance = currentBalance - total;
      await client.query(`UPDATE customers SET wallet_balance = $1 WHERE id = $2`, [newBalance, customer_id]);
      await client.query(
        `INSERT INTO wallet_transactions (customer_id, shop_id, type, amount, balance_after, sale_id, created_by)
         VALUES ($1,$2,'payment',$3,$4,$5,$6)`,
        [customer_id, shop_id, -total, newBalance, saleId, created_by]
      );
    }

    await client.query(
      `INSERT INTO sale_payments (sale_id, method, amount, status, confirmed_at)
       VALUES ($1,$2,$3,'confirmed', now())`,
      [saleId, payment.method, payment.method === 'wallet' ? total : payment.amount]
    );

    // commission: barber's commission_rate applies to service revenue only
    const barberRow = await client.query(`SELECT commission_rate FROM barbers WHERE id = $1`, [barber_id]);
    const rate = barberRow.rows[0] ? Number(barberRow.rows[0].commission_rate) : 0;
    const commissionAmount = serviceTotal * (rate / 100);
    await client.query(
      `INSERT INTO commissions (sale_id, barber_id, amount) VALUES ($1,$2,$3)`,
      [saleId, barber_id, commissionAmount]
    );

    // loyalty: 1 point per KSh 100 spent
    if (customer_id) {
      const points = Math.floor(total / 100);
      if (points > 0) {
        await client.query(
          `UPDATE customers SET loyalty_points = loyalty_points + $2 WHERE id = $1`,
          [customer_id, points]
        );
        await client.query(
          `INSERT INTO loyalty_transactions (customer_id, points_change, reason, sale_id)
           VALUES ($1,$2,'Sale purchase',$3)`,
          [customer_id, points, saleId]
        );
      }
    }

    // if this sale closes out a queue entry, mark it completed
    if (queue_entry_id) {
      await client.query(
        `UPDATE queue_entries SET status = 'completed', completed_at = now(), sale_id = $2 WHERE id = $1`,
        [queue_entry_id, saleId]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ id: saleId, subtotal, discount_amount: discountAmount, total });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Failed to record sale', detail: err.message });
  } finally {
    client.release();
  }
});

// GET /api/sales?shop_id=&from=&to= -> list individual transactions
// (for the Reports "Transactions" list, where the owner can review and
// delete a mistaken entry — different from /api/reports/sales, which
// returns daily aggregates for the sales chart)
router.get('/', async (req, res) => {
  const { shop_id, from, to } = req.query;
  if (!shop_id || !from || !to) return res.status(400).json({ error: 'shop_id, from, and to are required' });

  try {
    const { rows } = await pool.query(
      `SELECT
         sa.id, sa.created_at,
         COALESCE(cu.full_name, 'Walk-in') AS customer_name,
         bu.full_name AS barber_name,
         COALESCE(item_agg.items, '') AS items,
         sa.subtotal, sa.total,
         COALESCE(pay_agg.methods, '') AS payment_methods,
         ru.full_name AS rung_up_by,
         EXISTS(SELECT 1 FROM sale_payments sp WHERE sp.sale_id = sa.id AND sp.method = 'wallet') AS has_wallet_payment
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
       ORDER BY sa.created_at DESC`,
      [shop_id, from, to]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load transactions', detail: err.message });
  }
});

// DELETE /api/sales/:id -> void a transaction and reverse every side effect
// it caused: restore product stock, refund any wallet payment, reverse any
// loyalty points earned, and detach it from a queue entry if it closed one
// out. Everything happens in one transaction — either the whole sale and
// all its consequences are undone, or none of it is.
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const saleRow = await client.query(`SELECT id, shop_id, customer_id, total FROM sales WHERE id = $1`, [id]);
    if (!saleRow.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Restore stock for any products sold in this transaction
    const productLines = await client.query(
      `SELECT product_id, quantity FROM sale_line_items WHERE sale_id = $1 AND item_type = 'product'`,
      [id]
    );
    for (const line of productLines.rows) {
      await client.query(
        `UPDATE products SET stock_quantity = stock_quantity + $2 WHERE id = $1`,
        [line.product_id, line.quantity]
      );
    }

    // Refund any wallet payment tied to this sale, then remove the ledger
    // entry — voiding the sale should leave the wallet exactly as if the
    // sale never happened
    const walletTx = await client.query(
      `SELECT id, customer_id, amount FROM wallet_transactions WHERE sale_id = $1 AND type = 'payment'`,
      [id]
    );
    for (const tx of walletTx.rows) {
      await client.query(
        `UPDATE customers SET wallet_balance = wallet_balance - $2 WHERE id = $1`, // amount is negative, so subtracting adds it back
        [tx.customer_id, tx.amount]
      );
    }
    await client.query(`DELETE FROM wallet_transactions WHERE sale_id = $1`, [id]);

    // Reverse any loyalty points this sale earned
    const loyaltyTx = await client.query(
      `SELECT customer_id, points_change FROM loyalty_transactions WHERE sale_id = $1`,
      [id]
    );
    for (const tx of loyaltyTx.rows) {
      await client.query(
        `UPDATE customers SET loyalty_points = GREATEST(loyalty_points - $2, 0) WHERE id = $1`,
        [tx.customer_id, tx.points_change]
      );
    }
    await client.query(`DELETE FROM loyalty_transactions WHERE sale_id = $1`, [id]);

    // Detach from any queue entry it closed out, rather than leaving a
    // dangling reference (the queue entry itself stays, just no longer
    // marked as billed through this now-voided sale)
    await client.query(`UPDATE queue_entries SET sale_id = NULL WHERE sale_id = $1`, [id]);

    await client.query(`DELETE FROM commissions WHERE sale_id = $1`, [id]);
    await client.query(`DELETE FROM sale_payments WHERE sale_id = $1`, [id]);
    await client.query(`DELETE FROM sale_line_items WHERE sale_id = $1`, [id]);
    await client.query(`DELETE FROM sales WHERE id = $1`, [id]);

    await client.query('COMMIT');
    res.json({ deleted: true, id });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to delete transaction', detail: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
