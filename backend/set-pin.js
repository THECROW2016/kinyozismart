// Manual PIN-change utility. Not run automatically by anything (unlike
// migrate.js) — edit the PINS list below, then run this against the target
// database whenever you want to rotate an Owner/Manager login PIN.
//
// Locally:  DATABASE_URL="postgres://..." node backend/set-pin.js
// Against Railway's Postgres, from your machine (needs the Railway CLI,
// already linked to this project):  railway run node backend/set-pin.js
//
// Only owner/manager accounts can have a login PIN — this script refuses to
// touch any other role. The plaintext PINs below are never written to the
// database; only their scrypt hash is (see utils/pin.js).

require('dotenv').config();
const { Pool } = require('pg');
const { hashPin } = require('./utils/pin');

// Edit this, then run the script. full_name must match the account exactly.
const PINS = [
  // { full_name: 'Shop Owner', pin: '0000' },
  // { full_name: 'Store Manager', pin: '0000' },
];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function run() {
  if (!PINS.length) {
    console.error('Nothing to do — add entries to the PINS list at the top of this file first.');
    process.exitCode = 1;
    return;
  }
  for (const { full_name, pin } of PINS) {
    if (!/^\d{4}$/.test(String(pin))) {
      console.error(`Skipping "${full_name}": PIN must be exactly 4 digits.`);
      continue;
    }
    const { rows } = await pool.query(
      `UPDATE users SET pin_hash = $1
       WHERE full_name = $2 AND role IN ('owner', 'manager')
       RETURNING id, full_name, role`,
      [hashPin(pin), full_name]
    );
    if (!rows.length) {
      console.warn(`No owner/manager account named "${full_name}" found — skipped.`);
    } else {
      for (const r of rows) console.log(`PIN updated for ${r.full_name} (${r.role}).`);
    }
  }
  await pool.end();
}

run().catch(err => { console.error('[set-pin] failed:', err); process.exit(1); });
