# BarberOS (kinyozismart)

A point-of-sale, booking, and shop-management system for barbershops and salons in Kenya — POS, walk-in queue, appointments, staff commissions, inventory, and reporting, built around M-Pesa payments and SMS/WhatsApp notifications.

## Contents

- [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) — full product specification: modules, Kenya-specific requirements, architecture, and MVP roadmap
- [`db/schema.sql`](db/schema.sql) — PostgreSQL database schema (multi-branch ready)
- [`web/`](web/) — Dashboard, POS, Queue, Appointments, Customers, Staff, Inventory, Styles, Reports, Expenses, and Settings pages, plus the landing/login pages

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

- M-Pesa is not yet integrated with Daraja — payment method is recorded, but no STK push is actually sent.
- SMS/WhatsApp notifications aren't wired up — the queue's "you're next" flow only updates in-app right now.
- Everything is scoped to a single hardcoded shop ID for this stage; multi-shop login/switching isn't built yet (though the schema already supports it).

### Login (PIN-based)

The app now opens on a landing page (`index.html`) with two entry points — **Admin Login** and **Staff Login** — each leading to a PIN pad (`login.html`). Pick your name, enter a 4-digit PIN.

Demo PINs seeded by `migrate.js`:

| Name | Role | PIN |
|---|---|---|
| Shop Owner | admin (owner) | `1111` |
| Store Manager | manager | `1212` |

Session is stored in the browser (`localStorage`) after login; every other page redirects to `login.html` if there's no session. PINs are hashed with Node's built-in `scrypt` (not bcrypt, to avoid a native dependency) — fine for a low-stakes PIN, not intended as enterprise-grade auth.

### Roles: exactly two account types

- **Admin (owner):** full visibility into everything the business does — every page, including Settings.
- **Manager:** runs day-to-day operations — every page except Settings. Can add **and delete** Appointments, Staff, and Inventory. Deletes on Staff and Inventory are soft deletes (an `is_active` flag) so sales/commission history tied to them is never lost — they just drop off the active roster/catalog. Appointment deletes are permanent (nothing else depends on them). There's no delete capability anywhere else in the app.

Barbers and receptionists are still real records (needed for POS attribution, commissions, and specialties) but **don't log into the app individually** — only Admin and Manager accounts do. When registering a barber/receptionist from the Staff page, no PIN is requested; when registering a manager, a PIN is required.

This is enforced client-side in `auth-guard.js` (hides the Settings nav link + redirects on direct navigation for the Admin-only page) — matching the PIN system's overall security level, not a substitute for real server-side authorization if this goes into production with real money.

### Login history

Every Admin/Manager login and logout is recorded (`login_sessions` table) with a timestamp for each. The Staff page shows a "Login History" panel — who logged in, their role, when, and when they logged out (or "still logged in" if the session is active). This is separate from barber shift clock-in/out (which is about attendance for commission purposes, not app access).

### Expenses

A dedicated Expenses page tracks rent, utilities, salaries, supplies, and other costs (category, description, amount, date), feeding into the profit report (`revenue − expenses − commissions`). Both Admin and Manager can add and delete expense entries.

### Security

- **XSS protection**: every place user-entered text (customer names, appointment notes, staff names, product/service names, expense descriptions, etc.) gets rendered back into the page is now HTML-escaped (`web/utils.js`). Previously this was inserted via `innerHTML` unescaped in several places — a customer typing a name like `<img src=x onerror=...>` at the walk-in queue could have run arbitrary JS for anyone viewing that page.
- **Login rate limiting**: the login endpoint is capped at 20 requests per 15 minutes per IP, and additionally locks a specific account for 15 minutes after 5 wrong PIN attempts on it — a 4-digit PIN is only 10,000 combinations, so this matters.
- **General API rate limiting**: 600 requests / 15 min per IP across the API, to blunt scraping/abuse.
- **Session expiry**: a browser session now expires after 12 hours and forces a fresh login, instead of lasting forever.
- **Security headers** via `helmet` (CSP, X-Frame-Options, X-Content-Type-Options, etc.), scoped to what this app actually loads — note the CSP explicitly allows inline scripts/styles/`onclick` handlers (`'unsafe-inline'`) since the app relies on them throughout; a stricter nonce-based CSP would be a further improvement but requires reworking every inline handler.

None of this replaces the fact that PIN-based auth with no server-side session/JWT is inherently lighter-weight than a real production auth system — treat it as appropriate for internal shop staff use, not for anything handling sensitive data at scale.

### Look & feel

- Sidebar icons are hand-drawn inline SVGs (no emoji) for a consistent, sleek look across every page.
- The Manager Login screen (`login.html?group=manager`) uses a barbershop-themed photo as a background wallpaper; Admin Login stays on the plain dark theme.
- Responsive breakpoints tuned for both small phones (≤480px: smaller sidebar, reduced padding/font sizes) and tablet/narrow-window sizes (≤860–960px depending on page: sidebar collapses to icon-only, multi-column layouts stack).
- The Style Gallery feature has been removed.

This is client-side gating, matching the PIN system's overall security level — not a substitute for real server-side authorization if this goes into production with real money.

### Staff registration & photos

Owners can register new staff from the Staff page (name, phone, role, PIN, and — for barbers — specialties and commission rate). Photos are uploaded as a file, read client-side, and stored as a base64 data URL directly in the database (`users.photo_url`) — no separate file storage needed, and it survives redeploys since it lives in Postgres rather than the app's ephemeral filesystem.

### Receipt printing

After a sale completes in POS, a printable receipt appears (shop name/address, items, total, payment method, footer message). "Print Receipt" opens the browser print dialog with a print-only stylesheet so just the receipt prints, not the rest of the page.

