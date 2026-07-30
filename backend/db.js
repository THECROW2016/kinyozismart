const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'barberos_dev',
  database: process.env.PGDATABASE || 'barberos',
  // Railway's managed Postgres provides a single DATABASE_URL — prefer it when present
  connectionString: process.env.DATABASE_URL || undefined,
  // Only use SSL when explicitly requested (e.g. connecting to a public/managed
  // Postgres that requires it). Railway's private network does not need it.
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

module.exports = pool;
