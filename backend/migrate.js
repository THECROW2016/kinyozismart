// One-off migration runner: applies db/schema.sql then db/seed.sql against
// DATABASE_URL, but only if they haven't been applied yet. Safe to run on
// every deploy (used as Railway's preDeployCommand).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

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
  } finally {
    client.release();
    await pool.end();
  }
}

run()
  .then(() => { console.log('[migrate] done.'); process.exit(0); })
  .catch(err => { console.error('[migrate] failed:', err); process.exit(1); });
