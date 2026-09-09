require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const dashboardRoutes = require('./routes/dashboard');
const queueRoutes = require('./routes/queue');
const catalogRoutes = require('./routes/catalog');
const salesRoutes = require('./routes/sales');
const appointmentsRoutes = require('./routes/appointments');
const staffRoutes = require('./routes/staff');
const inventoryRoutes = require('./routes/inventory');
const expensesRoutes = require('./routes/expenses');
const reportsRoutes = require('./routes/reports');
const settingsRoutes = require('./routes/settings');
const authRoutes = require('./routes/auth');
const walletRoutes = require('./routes/wallet');
const pool = require('./db');

const app = express();
app.set('trust proxy', 1); // Railway sits behind a reverse proxy; needed for correct client IPs in rate limiting
const PORT = process.env.PORT || 3000;

// Security headers. CSP is scoped to what this app actually loads (Google
// Fonts, Chart.js from cdnjs, and its own inline scripts/styles/handlers —
// this app doesn't use CSP nonces, so 'unsafe-inline' is required) rather
// than left wide open.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      scriptSrcAttr: ["'unsafe-inline'"], // this app uses onclick="" handlers throughout
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"]
    }
  }
}));
app.use(cors());
app.use(express.json({ limit: '6mb' })); // staff photo uploads are sent as base64 data URLs

// General API rate limit — generous for normal shop use, but caps abuse/scraping
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api', apiLimiter);

// Much stricter limit specifically on login attempts, since a 4-digit PIN
// is brute-forceable (10,000 combinations) without this
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait a few minutes and try again.' }
});
app.use('/api/auth/login', loginLimiter);

// API routes
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api', catalogRoutes); // /api/services, /api/products, /api/barbers, /api/customers
app.use('/api/sales', salesRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/wallet', walletRoutes);

// TEMPORARY — read-only data integrity audit. Never writes anything.
// Remove this route once the audit is done.
app.get('/api/admin/integrity-check-2026-09-09', async (req, res) => {
  if (req.query.secret !== 'kinyozi-audit-4d81ef') {
    return res.status(403).json({ error: 'forbidden' });
  }
  try {
    const { rows } = await pool.query(`
      SELECT 'sales w/o valid barber' AS check_name, COUNT(*)::int AS count FROM sales s LEFT JOIN barbers b ON b.id=s.barber_id WHERE b.id IS NULL
      UNION ALL SELECT 'sales w/o valid shop', COUNT(*)::int FROM sales s LEFT JOIN shops sh ON sh.id=s.shop_id WHERE sh.id IS NULL
      UNION ALL SELECT 'sale_line_items w/o valid sale', COUNT(*)::int FROM sale_line_items li LEFT JOIN sales s ON s.id=li.sale_id WHERE s.id IS NULL
      UNION ALL SELECT 'sale_payments w/o valid sale', COUNT(*)::int FROM sale_payments p LEFT JOIN sales s ON s.id=p.sale_id WHERE s.id IS NULL
      UNION ALL SELECT 'commissions w/o valid sale', COUNT(*)::int FROM commissions c LEFT JOIN sales s ON s.id=c.sale_id WHERE s.id IS NULL
      UNION ALL SELECT 'commissions w/o valid barber', COUNT(*)::int FROM commissions c LEFT JOIN barbers b ON b.id=c.barber_id WHERE b.id IS NULL
      UNION ALL SELECT 'users w/o valid shop', COUNT(*)::int FROM users u LEFT JOIN shops sh ON sh.id=u.shop_id WHERE sh.id IS NULL
      UNION ALL SELECT 'barbers w/o valid user', COUNT(*)::int FROM barbers b LEFT JOIN users u ON u.id=b.id WHERE u.id IS NULL
      UNION ALL SELECT 'customers w/o valid shop', COUNT(*)::int FROM customers c LEFT JOIN shops sh ON sh.id=c.shop_id WHERE sh.id IS NULL
      UNION ALL SELECT 'wallet_transactions w/o valid customer', COUNT(*)::int FROM wallet_transactions wt LEFT JOIN customers c ON c.id=wt.customer_id WHERE c.id IS NULL
      UNION ALL SELECT 'wallet_transactions w/ dangling sale_id', COUNT(*)::int FROM wallet_transactions wt LEFT JOIN sales s ON s.id=wt.sale_id WHERE wt.sale_id IS NOT NULL AND s.id IS NULL
      UNION ALL SELECT 'appointments w/o valid shop', COUNT(*)::int FROM appointments a LEFT JOIN shops sh ON sh.id=a.shop_id WHERE sh.id IS NULL
      UNION ALL SELECT 'appointment_services w/o valid appointment', COUNT(*)::int FROM appointment_services aps LEFT JOIN appointments a ON a.id=aps.appointment_id WHERE a.id IS NULL
      UNION ALL SELECT 'queue_entries w/o valid shop', COUNT(*)::int FROM queue_entries q LEFT JOIN shops sh ON sh.id=q.shop_id WHERE sh.id IS NULL
      UNION ALL SELECT 'attendance w/o valid barber', COUNT(*)::int FROM attendance a LEFT JOIN barbers b ON b.id=a.barber_id WHERE b.id IS NULL
      UNION ALL SELECT 'login_sessions w/o valid user', COUNT(*)::int FROM login_sessions ls LEFT JOIN users u ON u.id=ls.user_id WHERE u.id IS NULL
      UNION ALL SELECT 'expenses w/o valid shop', COUNT(*)::int FROM expenses e LEFT JOIN shops sh ON sh.id=e.shop_id WHERE sh.id IS NULL
      UNION ALL SELECT 'products w/o valid shop', COUNT(*)::int FROM products p LEFT JOIN shops sh ON sh.id=p.shop_id WHERE sh.id IS NULL
      UNION ALL SELECT 'purchase_items w/o valid purchase', COUNT(*)::int FROM purchase_items pi LEFT JOIN purchases p ON p.id=pi.purchase_id WHERE p.id IS NULL
      UNION ALL SELECT 'services w/o valid shop', COUNT(*)::int FROM services sv LEFT JOIN shops sh ON sh.id=sv.shop_id WHERE sh.id IS NULL
      UNION ALL SELECT 'negative wallet balances', COUNT(*)::int FROM customers WHERE wallet_balance < 0
      UNION ALL SELECT 'negative stock quantities', COUNT(*)::int FROM products WHERE stock_quantity < 0
      UNION ALL SELECT 'barber/beautician/receptionist w/ pin set (should be 0)', COUNT(*)::int FROM users WHERE role IN ('barber','beautician','receptionist') AND pin_hash IS NOT NULL
      UNION ALL SELECT 'owner/manager/secretary w/o pin set (should be 0)', COUNT(*)::int FROM users WHERE role IN ('owner','manager','secretary') AND pin_hash IS NULL
      UNION ALL SELECT 'sale total mismatch vs subtotal/discount (tolerance 2 cents)', COUNT(*)::int FROM sales
        WHERE ABS(total - GREATEST(subtotal - (CASE WHEN discount_type='percentage' THEN subtotal * COALESCE(discount_value,0)/100.0 ELSE COALESCE(discount_value,0) END), 0)) > 0.02
      UNION ALL SELECT 'sale total mismatch vs sum of line items (tolerance 2 cents)', COUNT(*)::int FROM (
        SELECT s.id, s.subtotal, SUM(li.line_total) AS line_sum FROM sales s JOIN sale_line_items li ON li.sale_id=s.id GROUP BY s.id, s.subtotal
      ) x WHERE ABS(x.subtotal - x.line_sum) > 0.02
      UNION ALL SELECT 'sale_payments amount mismatch vs sale total (tolerance 2 cents, non-split only)', COUNT(*)::int FROM sale_payments p JOIN sales s ON s.id=p.sale_id
        WHERE p.method != 'split' AND ABS(p.amount - s.total) > 0.02
    `);

    const mismatchDetail = await pool.query(`
      SELECT id, created_at, subtotal, discount_type, discount_value, total,
        GREATEST(subtotal - (CASE WHEN discount_type='percentage' THEN subtotal * COALESCE(discount_value,0)/100.0 ELSE COALESCE(discount_value,0) END), 0) AS expected_total
      FROM sales
      WHERE ABS(total - GREATEST(subtotal - (CASE WHEN discount_type='percentage' THEN subtotal * COALESCE(discount_value,0)/100.0 ELSE COALESCE(discount_value,0) END), 0)) > 0.02
    `);

    res.json({ checks: rows, mismatch_detail: mismatchDetail.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'audit failed', detail: err.message });
  }
});

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected', detail: err.message });
  }
});

// Serve the static frontend (dashboard/pos/queue) from ../web
app.use(express.static(path.join(__dirname, '..', 'web')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`BarberOS backend running on port ${PORT}`);
});
