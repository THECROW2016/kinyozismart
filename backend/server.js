require('dotenv').config();
const express = require('express');
const cors = require('cors');
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
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '6mb' })); // staff photo uploads are sent as base64 data URLs

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
