// One-off migration runner: applies db/schema.sql then db/seed.sql against
// DATABASE_URL, but only if they haven't been applied yet. Safe to run on
// every deploy (used as Railway's preDeployCommand).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { hashPin } = require('./utils/pin');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

// Initial PINs for the two seeded login accounts (Owner, Manager). Only used
// to compute a hash below — the database never stores these plaintext, only
// the scrypt hash (see utils/pin.js). Any account not listed here falls back
// to '0000', but in practice that never applies: only owner/manager roles
// ever get a pin_hash at all (see the corrective cleanup further down), and
// both of those are listed here.
// To change a PIN later, use backend/set-pin.js instead of editing these —
// this backfill only fires once per account (when pin_hash is still NULL).
const INITIAL_PINS = {
  '21111111-1111-1111-1111-111111111199': '4549', // Shop Owner (admin)
  '21111111-1111-1111-1111-111111111198': '2891'  // Store Manager
};

async function run() {
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const seedPath = path.join(__dirname, '..', 'db', 'seed.sql');

  const client = await pool.connect();
  try {
    const tableCheck = await client.query(`SELECT to_regclass('public.shops') AS exists`);
    if (tableCheck.rows[0].exists) {
      console.log('[migrate] schema already applied, skipping schema.sql');
    } else {
      console.log('[migrate] applying schema.sql...');
      await client.query(fs.readFileSync(schemaPath, 'utf8'));
      console.log('[migrate] schema applied.');
    }

    const seedCheck = await client.query(`SELECT COUNT(*) FROM shops`);
    if (Number(seedCheck.rows[0].count) > 0) {
      console.log('[migrate] data already present, skipping seed.sql');
    } else {
      console.log('[migrate] applying seed.sql...');
      await client.query(fs.readFileSync(seedPath, 'utf8'));
      console.log('[migrate] seed data applied.');
    }

    // Ensure pin_hash exists even on databases migrated before PIN login was added.
    // Only owner/manager accounts log in — barbers/receptionists are intentionally
    // created without a PIN, so they must never be swept up here.
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash TEXT`);
    const { rows: needPin } = await client.query(
      `SELECT id FROM users WHERE pin_hash IS NULL AND role IN ('owner', 'manager')`
    );
    if (needPin.length) {
      console.log(`[migrate] assigning initial PINs to ${needPin.length} user(s)...`);
      for (const u of needPin) {
        const pin = INITIAL_PINS[u.id] || '0000';
        await client.query(`UPDATE users SET pin_hash = $2 WHERE id = $1`, [u.id, hashPin(pin)]);
      }
      console.log('[migrate] initial PINs assigned.');
    } else {
      console.log('[migrate] all users already have PINs.');
    }

    // One-time rename: the demo shop was originally seeded as "Kinyozi Ndogo"
    const renamed = await client.query(
      `UPDATE shops SET name = 'Kinyozi Management System' WHERE name = 'Kinyozi Ndogo' RETURNING id`
    );
    if (renamed.rows.length) {
      console.log(`[migrate] renamed ${renamed.rows.length} shop(s) to Kinyozi Management System.`);
    }

    // Ensure the Manager account exists, to exercise the manager-vs-owner
    // role distinction (manager: operational + reports, no Settings/staff registration)
    const MANAGER_ID = '21111111-1111-1111-1111-111111111198';
    const managerCheck = await client.query(`SELECT id FROM users WHERE id = $1`, [MANAGER_ID]);
    if (!managerCheck.rows.length) {
      await client.query(
        `INSERT INTO users (id, shop_id, full_name, phone, password_hash, pin_hash, role)
         VALUES ($1, '11111111-1111-1111-1111-111111111111', 'Store Manager', '0722000001', '', $2, 'manager')
         ON CONFLICT (id) DO NOTHING`,
        [MANAGER_ID, hashPin(INITIAL_PINS[MANAGER_ID])]
      );
      console.log('[migrate] created Manager account.');
    }

    // Corrective cleanup: an earlier version of this script assigned login PINs
    // to barber/receptionist accounts too, which unintentionally gave them a
    // login path with broader UI access than intended. They should never have one.
    const cleared = await client.query(
      `UPDATE users SET pin_hash = NULL WHERE role IN ('barber', 'receptionist') AND pin_hash IS NOT NULL RETURNING id`
    );
    if (cleared.rows.length) {
      console.log(`[migrate] cleared incorrectly-assigned PINs from ${cleared.rows.length} barber/receptionist account(s).`);
    }

    // Ensure login_sessions exists even on databases migrated before this
    // login/logout audit trail was added
    await client.query(`
      CREATE TABLE IF NOT EXISTS login_sessions (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
        login_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        logout_at   TIMESTAMPTZ
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_login_sessions_shop_login ON login_sessions(shop_id, login_at DESC)
    `);
  } finally {
    client.release();
    await pool.end();
  }
}

run()
  .then(() => { console.log('[migrate] done.'); process.exit(0); })
  .catch(err => { console.error('[migrate] failed:', err); process.exit(1); });
