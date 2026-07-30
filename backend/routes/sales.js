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
    const total = Math.max(subtotal - discountAmount, 0);

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

    await client.query(
      `INSERT INTO sale_payments (sale_id, method, amount, status, confirmed_at)
       VALUES ($1,$2,$3,'confirmed', now())`,
      [saleId, payment.method, payment.amount]
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
    console.error(err);
    res.status(500).json({ error: 'Failed to record sale', detail: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
