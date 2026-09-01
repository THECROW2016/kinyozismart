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

// TEMPORARY — one-time consolidation. Discovered after deploy: the shop's
// pre-existing (uncategorized) services already have real sales history;
// the freshly-inserted categorized catalog was the redundant one.
// Step 1 categorizes the real, in-use services (safe — only sets
// `category`, never touches price/name/id, so nothing that references
// these rows by id is affected).
// Step 2 removes specific, individually-named duplicate rows from the
// newly-inserted catalog — each one is an exact, hand-verified 1:1 pairing
// (not a fuzzy price/category match, which turned out to cause false
// positives when two unrelated services shared a price). Only rows with
// zero sales are ever targeted. Remove this route after it's been run once.
app.post('/api/admin/consolidate-services-2026-09-01', async (req, res) => {
  if (req.query.secret !== 'kinyozi-consolidate-7b2e04') {
    return res.status(403).json({ error: 'forbidden' });
  }
  // [existing name, price, category to assign]
  const CATEGORIZE = [
    ['Beard Cut', 500, 'Cuts'],
    ['Bigen ( creamof nature) shave & application', 2000, 'Dyes'],
    ['Caucasian Scissors', 2000, 'Cuts'],
    ['Charcoal Pedi', 3000, 'Spa'],
    ['Cinnabar', 2500, 'Facial Scrubs'],
    ['Dye (BIGEN SPEEDY) application only', 1000, 'Dyes'],
    ['Dye (Bigen Speedy) shave & application', 2500, 'Dyes'],
    ['Dye (Cream of nature ) application only', 1500, 'Dyes'],
    ['Dyes (Black Shampoo) application only', 1000, 'Dyes'],
    ['Dyes (Black Shampoo) shave & application', 1500, 'Dyes'],
    ['Forever Products', 3500, 'Facial Scrubs'],
    ['Full Facal -Cinnabar', 5000, 'Full Facial'],
    ['Full Facial - Mary Kay', 5500, 'Full Facial'],
    ['Full Facial -Forever', 5500, 'Full Facial'],
    ['Full Facial -Nivea', 2000, 'Full Facial'], // price kept as-is — see note in response
    ['Full Facial -St.Ives', 4000, 'Full Facial'],
    ['Gel Application', 1000, 'Spa'],
    ['Hair treatment', 1000, 'Dyes'],
    ['Kids Cut & Dye', 1000, 'Cuts'],
    ['Manicure', 1000, 'Spa'],
    ['Mary Kay', 3500, 'Facial Scrubs'],
    ['Massage (Back Massage)', 3000, 'Massages'],
    ['Massage (Body Scrub)', 5000, 'Massages'],
    ['Massage (Deep Tissue)', 5000, 'Massages'],
    ['Massage (Head & Shoulder)', 2000, 'Massages'],
    ['Massage (Head Scrub)', 1500, 'Massages'],
    ['Massage (Hot Stone)', 6000, 'Massages'],
    ['Massage (Swedish)', 4500, 'Massages'],
    ['Mens', 1000, 'Cuts'],
    ['Nail Trim', 500, 'Spa'],
    ['Nail trim', 500, 'Spa'],
    ['Nivea', 2000, 'Facial Scrubs'],
    ['Pedicure', 2000, 'Spa'],
    ['Revlon', 2000, 'Dyes'],
    ['Shave and own dye', 1300, 'Dyes'],
    ['St.Ives', 1500, 'Facial Scrubs'],
    ['Teens', 600, 'Cuts'],
    ['Texturizer ( with hair cut)', 1500, 'Dyes'],
    ['Texturizer', 1000, 'Dyes'],
    ['Waxing (Bikini)', 2500, 'Waxing'],
    ['Waxing (Brazilian)', 3500, 'Waxing'],
    ['Waxing (Underarm)', 1000, 'Waxing'],
    ['kids', 500, 'Cuts'],
    ['ladies cut', 2000, 'Cuts']
  ];

  // Exact new-catalog rows to remove: [name, category, price] — hand-paired
  // to the real service it duplicates. "Full Facial — Nivea" is deliberately
  // excluded (price mismatch: old is 2000, new is 4500 — needs a human call).
  const REMOVE_DUPLICATES = [
    ['Beard Cut', 'Cuts', 500],
    ['Bigen Cream — Shave & Application', 'Dyes', 2000],
    ['Caucasian Scissors', 'Cuts', 2000],
    ['Charcoal Pedi', 'Spa', 3000],
    ['Facial Scrub — Cinnabar', 'Facial Scrubs', 2500],
    ['Bigen Speedy — Application Only', 'Dyes', 1000],
    ['Bigen Speedy — Shave & Application', 'Dyes', 2500],
    ['Cream of Nature', 'Dyes', 1500],
    ['Black Shampoo — Application Only', 'Dyes', 1000],
    ['Black Shampoo — Shave & Application', 'Dyes', 1500],
    ['Facial Scrub — Forever Products', 'Facial Scrubs', 3500],
    ['Full Facial — Cinnabar', 'Full Facial', 5000],
    ['Full Facial — Mary Kay', 'Full Facial', 5500],
    ['Full Facial — Forever', 'Full Facial', 5500],
    ['Full Facial — St.Ives', 'Full Facial', 4000],
    ['Gel Application', 'Spa', 1000],
    ['Hair Treatment', 'Dyes', 1000],
    ['Kids Cut & Dye', 'Cuts', 1000],
    ['Manicure', 'Spa', 1000],
    ['Facial Scrub — Mary Kay', 'Facial Scrubs', 3500],
    ['Back Massage', 'Massages', 3000],
    ['Body Scrub', 'Massages', 5000],
    ['Deep Tissue Massage', 'Massages', 5000],
    ['Head & Shoulder Massage', 'Massages', 2000],
    ['Head Scrub', 'Massages', 1500],
    ['Hot Stone Massage', 'Massages', 6000],
    ['Swedish Massage', 'Massages', 4500],
    ['Haircut — Men', 'Cuts', 1000],
    ['Nail Trim', 'Spa', 500],
    ['Facial Scrub — Nivea', 'Facial Scrubs', 2000],
    ['Pedicure', 'Spa', 2000],
    ['Revlon', 'Dyes', 2000],
    ['Shave & Own Dye', 'Dyes', 1300],
    ['Facial Scrub — St.Ives', 'Facial Scrubs', 1500],
    ['Teens', 'Cuts', 600],
    ['Dye With Haircut', 'Dyes', 1500],
    ['Texturizer', 'Dyes', 1000],
    ['Waxing — Bikini', 'Waxing', 2500],
    ['Waxing — Brazillian', 'Waxing', 3500],
    ['Waxing — Underarm', 'Waxing', 1000],
    ['Haircut — Kids', 'Cuts', 500],
    ['Ladies Cut', 'Cuts', 2000]
  ];

  try {
    let categorized = 0;
    for (const [name, price, category] of CATEGORIZE) {
      const r = await pool.query(
        `UPDATE services SET category = $3 WHERE name = $1 AND price = $2 AND category IS NULL`,
        [name, price, category]
      );
      categorized += r.rowCount;
    }

    let removed = [];
    for (const [name, category, price] of REMOVE_DUPLICATES) {
      // Only delete if this exact row has zero sales linked to it
      const r = await pool.query(
        `DELETE FROM services s
         WHERE s.name = $1 AND s.category = $2 AND s.price = $3
           AND NOT EXISTS (SELECT 1 FROM sale_line_items li WHERE li.service_id = s.id)
         RETURNING s.id`,
        [name, category, price]
      );
      if (r.rowCount) removed.push(name);
    }

    const finalCount = await pool.query('SELECT COUNT(*) FROM services');
    res.json({
      services_categorized: categorized,
      duplicates_removed: removed.length,
      removed_names: removed,
      final_service_count: Number(finalCount.rows[0].count),
      note: '"Full Facial — Nivea" was NOT touched — old entry is priced 2000, new catalog entry is 4500. That price gap needs a human decision, not an automatic one.'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'consolidation failed', detail: err.message });
  }
});
app.use('/api/auth', authRoutes);

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
