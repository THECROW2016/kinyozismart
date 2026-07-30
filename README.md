# BarberOS (kinyozismart)

A point-of-sale, booking, and shop-management system for barbershops and salons in Kenya — POS, walk-in queue, appointments, staff commissions, inventory, and reporting, built around M-Pesa payments and SMS/WhatsApp notifications.

## Contents

- [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) — full product specification: modules, Kenya-specific requirements, architecture, and MVP roadmap
- [`db/schema.sql`](db/schema.sql) — PostgreSQL database schema (multi-branch ready)
- [`web/dashboard.html`](web/dashboard.html) — dashboard UI mockup
- [`web/pos.html`](web/pos.html) — POS / New Sale screen mockup
- [`web/queue.html`](web/queue.html) — walk-in queue ("Waiting Bench") screen mockup

## Flagship feature: the walk-in queue

Most Kenyan barbershops run on walk-ins, not bookings. The queue module lets a receptionist add a walk-in (name, service, barber), tracks live wait time, and notifies the barber and customer by SMS/WhatsApp when it's the customer's turn — see `web/queue.html` for the UI and the `queue_entries` table in `db/schema.sql` for the data model.

## Working system

This is now a real, wired-up full-stack app, not just mockups:

- **`backend/`** — Node.js + Express API (`server.js`) connected to PostgreSQL via `pg`. Serves the JSON API under `/api/*` and the static frontend from `web/`.
- **`web/`** — the dashboard, POS, and queue pages now fetch live data from the API and write real changes back (add a walk-in, call/start a queue entry, complete a sale) instead of showing static mock content.
- **`db/schema.sql`** — run this first against a fresh database.
- **`db/seed.sql`** — optional demo data (one shop, 4 barbers, 8 customers, services, products, and a live queue) matching what's shown in the UI.

### Run it locally

```bash
# 1. Create a Postgres database and load the schema
createdb barberos
psql -d barberos -f db/schema.sql
psql -d barberos -f db/seed.sql   # optional demo data

# 2. Start the backend (also serves the frontend)
cd backend
npm install
PGHOST=localhost PGUSER=postgres PGPASSWORD=yourpassword PGDATABASE=barberos npm start

# 3. Open the app
# http://localhost:3000/            -> dashboard
# http://localhost:3000/pos.html     -> POS
# http://localhost:3000/queue.html   -> queue
```

### Deploy on Railway

1. Create a new Railway project from this GitHub repo.
2. Add a **PostgreSQL** plugin to the project — Railway sets `DATABASE_URL` automatically, which `backend/db.js` already reads in preference to individual `PGHOST`/`PGUSER`/etc. vars.
3. Run the schema once against the new database (e.g. `psql "$DATABASE_URL" -f db/schema.sql`, and optionally `db/seed.sql` for demo data) — from your machine or a Railway one-off shell.
4. Deploy the web service — `nixpacks.toml` at the repo root tells Railway to install dependencies from `backend/` and start with `node backend/server.js`.
5. Once deployed, the dashboard/POS/queue pages are served directly from the same service at its Railway-provided URL.

### Known limitations (by design, for this stage)

- No authentication yet — `created_by` on sales is hardcoded to a seed "owner" user. Add real login before using this with real money.
- M-Pesa is not yet integrated with Daraja — payment method is recorded, but no STK push is actually sent.
- SMS/WhatsApp notifications aren't wired up — the queue's "you're next" flow only updates in-app right now.
- Everything is scoped to a single hardcoded shop ID for this stage; multi-shop login/switching isn't built yet (though the schema already supports it).

