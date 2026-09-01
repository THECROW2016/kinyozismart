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

// Initial PINs for the three login-capable seeded accounts (Owner, Manager,
// Secretary). Only used to compute a hash below — the database never stores
// these plaintext, only the scrypt hash (see utils/pin.js).
// To change a PIN later, use backend/set-pin.js instead of editing these —
// this backfill only fires once per account (when pin_hash is still NULL).
const INITIAL_PINS = {
  '21111111-1111-1111-1111-111111111199': '4549', // Shop Owner (admin)
  '21111111-1111-1111-1111-111111111198': '2891', // Store Manager
  '21111111-1111-1111-1111-111111111197': '7734'  // Front Desk Secretary
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

    // Add the new role values for databases created before secretary/beautician
    // existed. ADD VALUE IF NOT EXISTS is safe to re-run every deploy.
    await client.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'secretary'`);
    await client.query(`ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'beautician'`);

    // Ensure pin_hash exists even on databases migrated before PIN login was added.
    // Only owner/manager/secretary accounts log in — barbers, beauticians, and
    // receptionists are intentionally created without a PIN.
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash TEXT`);
    const { rows: needPin } = await client.query(
      `SELECT id FROM users WHERE pin_hash IS NULL AND role IN ('owner', 'manager', 'secretary')`
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

    // Ensure the Manager account exists
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

    // Ensure the Secretary account exists — inserts daily sale data, can't delete
    const SECRETARY_ID = '21111111-1111-1111-1111-111111111197';
    const secretaryCheck = await client.query(`SELECT id FROM users WHERE id = $1`, [SECRETARY_ID]);
    if (!secretaryCheck.rows.length) {
      await client.query(
        `INSERT INTO users (id, shop_id, full_name, phone, password_hash, pin_hash, role)
         VALUES ($1, '11111111-1111-1111-1111-111111111111', 'Front Desk Secretary', '0722000002', '', $2, 'secretary')
         ON CONFLICT (id) DO NOTHING`,
        [SECRETARY_ID, hashPin(INITIAL_PINS[SECRETARY_ID])]
      );
      console.log('[migrate] created Secretary account.');
    }

    // Receptionists, barbers, and beauticians are records-only and should
    // never have a login PIN. (Barbers briefly logged in same as managers in
    // an earlier version of this app — that's been reverted, so any PIN left
    // over from that gets cleared here.)
    const cleared = await client.query(
      `UPDATE users SET pin_hash = NULL WHERE role IN ('receptionist', 'barber', 'beautician') AND pin_hash IS NOT NULL RETURNING id`
    );
    if (cleared.rows.length) {
      console.log(`[migrate] cleared incorrectly-assigned PINs from ${cleared.rows.length} non-login account(s).`);
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

    // One-time reset, requested by the shop owner, to clear out old/test
    // appointment data and start fresh. Guarded by a flag so it only ever
    // runs once, regardless of how many future deploys happen.
    await client.query(`
      CREATE TABLE IF NOT EXISTS migration_flags (
        key TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    const flagCheck = await client.query(
      `SELECT 1 FROM migration_flags WHERE key = 'appointments_reset_2026_08_25'`
    );
    if (!flagCheck.rows.length) {
      const delResult = await client.query(`DELETE FROM appointments`); // cascades to appointment_services
      await client.query(
        `INSERT INTO migration_flags (key) VALUES ('appointments_reset_2026_08_25')`
      );
      console.log(`[migrate] one-time reset: cleared ${delResult.rowCount} appointment(s) to start fresh.`);
    }

    // Ensure services.category exists even on databases migrated before
    // categorized services were added
    await client.query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS category TEXT`);

    // One-time: populate the real service menu (Men's Den Executive Barbershop
    // & Spa price list) with categories, matching the shop's printed poster.
    // Additive only — never deletes any service already entered manually.
    const catalogFlag = await client.query(
      `SELECT 1 FROM migration_flags WHERE key = 'services_catalog_poster_2026_09_01'`
    );
    if (!catalogFlag.rows.length) {
      const SHOP_ID = '11111111-1111-1111-1111-111111111111';
      const CATALOG = [
        // Cuts
        ['Haircut — Men', 'Cuts', 1000, 30],
        ['Haircut — Kids', 'Cuts', 500, 20],
        ['Ladies Cut', 'Cuts', 2000, 45],
        ['Caucasian Clippers', 'Cuts', 2000, 30],
        ['Caucasian Scissors', 'Cuts', 2000, 30],
        ['Beard Cut', 'Cuts', 500, 15],
        ['Teens', 'Cuts', 600, 25],
        ['Kids Cut & Dye', 'Cuts', 1000, 30],
        // Dyes
        ['Black Shampoo — Application Only', 'Dyes', 1000, 30],
        ['Black Shampoo — Shave & Application', 'Dyes', 1500, 45],
        ['Bigen Speedy — Application Only', 'Dyes', 1000, 30],
        ['Bigen Speedy — Shave & Application', 'Dyes', 2500, 45],
        ['Bigen Cream — Application Only', 'Dyes', 1500, 30],
        ['Bigen Cream — Shave & Application', 'Dyes', 2000, 45],
        ['Cream of Nature', 'Dyes', 1500, 40],
        ['Revlon', 'Dyes', 2000, 40],
        ['Shave & Own Dye', 'Dyes', 1300, 30],
        ['Hair Treatment', 'Dyes', 1000, 30],
        ['Head Scrub', 'Dyes', 1500, 20],
        ['Texturizer', 'Dyes', 1000, 30],
        ['Dye With Haircut', 'Dyes', 1500, 45],
        // Spa
        ['Nail Trim', 'Spa', 500, 15],
        ['Manicure', 'Spa', 1000, 30],
        ['Pedicure', 'Spa', 2000, 40],
        ['Charcoal Pedi', 'Spa', 3000, 45],
        ['Gel Application', 'Spa', 1000, 30],
        // Waxing
        ['Waxing — Underarm', 'Waxing', 1000, 20],
        ['Waxing — Bikini', 'Waxing', 2500, 30],
        ['Waxing — Brazillian', 'Waxing', 3500, 40],
        // Facial Scrubs
        ['Facial Scrub — St.Ives', 'Facial Scrubs', 1500, 30],
        ['Facial Scrub — Nivea', 'Facial Scrubs', 2000, 30],
        ['Facial Scrub — Cinnabar', 'Facial Scrubs', 2500, 30],
        ['Facial Scrub — Forever Products', 'Facial Scrubs', 3500, 35],
        ['Facial Scrub — Mary Kay', 'Facial Scrubs', 3500, 35],
        // Full Facial
        ['Full Facial — St.Ives', 'Full Facial', 4000, 45],
        ['Full Facial — Nivea', 'Full Facial', 4500, 45],
        ['Full Facial — Cinnabar', 'Full Facial', 5000, 45],
        ['Full Facial — Forever', 'Full Facial', 5500, 50],
        ['Full Facial — Mary Kay', 'Full Facial', 5500, 50],
        // Massages
        ['Head & Shoulder Massage', 'Massages', 2000, 30],
        ['Back Massage', 'Massages', 3000, 40],
        ['Swedish Massage', 'Massages', 4500, 60],
        ['Deep Tissue Massage', 'Massages', 5000, 60],
        ['Body Scrub', 'Massages', 5000, 45],
        ['Hot Stone Massage', 'Massages', 6000, 60],
        ['Head Scrub', 'Massages', 1500, 20]
      ];
      for (const [name, category, price, duration] of CATALOG) {
        await client.query(
          `INSERT INTO services (shop_id, name, category, price, duration_mins) VALUES ($1,$2,$3,$4,$5)`,
          [SHOP_ID, name, category, price, duration]
        );
      }
      await client.query(`INSERT INTO migration_flags (key) VALUES ('services_catalog_poster_2026_09_01')`);
      console.log(`[migrate] one-time: added ${CATALOG.length} services from the Men's Den price list.`);
    }

    // One-time: update the shop's contact number. Flag-guarded so it never
    // overwrites a phone number changed later via Settings.
    const phoneFlag = await client.query(
      `SELECT 1 FROM migration_flags WHERE key = 'shop_phone_update_2026_09_01'`
    );
    if (!phoneFlag.rows.length) {
      await client.query(
        `UPDATE shops SET phone = '0722363333' WHERE id = '11111111-1111-1111-1111-111111111111'`
      );
      await client.query(`INSERT INTO migration_flags (key) VALUES ('shop_phone_update_2026_09_01')`);
      console.log('[migrate] one-time: updated shop contact number to 0722363333.');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run()
  .then(() => { console.log('[migrate] done.'); process.exit(0); })
  .catch(err => { console.error('[migrate] failed:', err); process.exit(1); });
