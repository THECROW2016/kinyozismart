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
