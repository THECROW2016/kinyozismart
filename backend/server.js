require('dotenv').config();
const express = require('express');
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
const { requireAuth, allow, noSecretaryDelete } = require('./utils/authz');

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
// Frontend is served from the same origin, so no CORS is enabled.
// Staff photo uploads are base64 data URLs and need a larger body; everything else is small.
app.use('/api/staff', express.json({ limit: '6mb' }));
app.use(express.json({ limit: '100kb' }));

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

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected' });
  }
});

// API routes. Login/staff-picker/health are public; everything else needs a
// signed token, and sensitive areas are restricted by role on the server.
const OM = allow('owner', 'manager');
app.use('/api/auth/sessions', requireAuth, OM);
app.use('/api/dashboard', requireAuth, OM, dashboardRoutes);
app.use('/api/queue', requireAuth, noSecretaryDelete, queueRoutes);
app.use('/api/staff', requireAuth, OM, staffRoutes);
app.use('/api/inventory', requireAuth, OM, inventoryRoutes);
app.use('/api/expenses', requireAuth, OM, expensesRoutes);
app.use('/api/reports', requireAuth, OM, reportsRoutes);
app.use('/api/settings', requireAuth, (req, res, next) =>
  req.method === 'GET' && req.path === '/shop' ? next() : allow('owner')(req, res, next), settingsRoutes);
app.use('/api/sales', requireAuth, noSecretaryDelete, salesRoutes);
app.use('/api/appointments', requireAuth, noSecretaryDelete, appointmentsRoutes);
app.use('/api/wallet', requireAuth, walletRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth, catalogRoutes); // /api/services, /api/products, /api/barbers, /api/customers

// Serve the static frontend (dashboard/pos/queue) from ../web
app.use(express.static(path.join(__dirname, '..', 'web')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`BarberOS backend running on port ${PORT}`);
});
