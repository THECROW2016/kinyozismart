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
- **`db/seed.sql`** — baseline data: one shop plus the Owner account (the Manager account is created separately by `backend/migrate.js`, which also hashes its PIN). No demo barbers, customers, services, or transactions — add those for real once the app is live.

### Run it locally

```bash
# 1. Create a Postgres database, then load schema + seed data and hash the
#    login PINs in one go (this is what migrate.js does; raw psql alone
#    won't set pin_hash, so login won't work without this step).
#    Note: migrate.js reads DATABASE_URL specifically, not PGHOST/etc.
createdb barberos
cd backend
npm install
DATABASE_URL="postgres://postgres:yourpassword@localhost:5432/barberos" node migrate.js

# 2. Start the backend (also serves the frontend)
PGHOST=localhost PGUSER=postgres PGPASSWORD=yourpassword PGDATABASE=barberos npm start

# 3. Open the app
# http://localhost:3000/            -> dashboard
# http://localhost:3000/pos.html     -> POS
# http://localhost:3000/queue.html   -> queue
```

### Deploy on Railway

1. Create a new Railway project from this GitHub repo. Leave the service's **Root Directory** at the repo root (blank) — `nixpacks.toml` expects to run from there (`cd backend && npm ci`), and `server.js` serves the frontend from `../web`, so both `backend/` and `web/` need to be in the build context together.
2. Add a **PostgreSQL** plugin to the same project — Railway sets `DATABASE_URL` automatically, which `backend/db.js` already reads in preference to individual `PGHOST`/`PGUSER`/etc. vars.
3. In the web service's Settings → Deploy, set the **Pre-Deploy Command** to `node backend/migrate.js`. This applies `db/schema.sql`/`db/seed.sql` on first run and is safe to leave in place permanently — it's idempotent and also carries forward schema/data fixes (e.g. the login audit trail table, PIN-security cleanup) on every subsequent deploy.
4. Deploy the web service — `nixpacks.toml` at the repo root tells Railway to install dependencies from `backend/` and start with `node backend/server.js`.
5. Once deployed, the dashboard/POS/queue pages are served directly from the same service at its Railway-provided URL.

### Known limitations (by design, for this stage)

- M-Pesa is not yet integrated with Daraja — payment method is recorded, but no STK push is actually sent.
- SMS/WhatsApp notifications aren't wired up — the queue's "you're next" flow only updates in-app right now.
- Everything is scoped to a single hardcoded shop ID for this stage; multi-shop login/switching isn't built yet (though the schema already supports it).

### Login (PIN-based)

The app opens on a landing page (`index.html`) with three entry points — **Admin Login**, **Manager Login**, and **Secretary Login** — each leading to a PIN pad (`login.html?group=admin|manager|secretary`). Pick your name, enter a 4-digit PIN.

Initial PINs for the three seeded accounts (Shop Owner, Store Manager, Front Desk Secretary) are set in `backend/migrate.js` (`INITIAL_PINS`) — read them there rather than here, so this doc can't go stale again. To change any PIN later, edit and run `backend/set-pin.js` against the target database rather than editing `migrate.js` (its backfill only fires once, when `pin_hash` is still unset).

Session is stored in the browser (`localStorage`) after login; every other page redirects to `login.html` if there's no session. PINs are hashed with Node's built-in `scrypt` (not bcrypt, to avoid a native dependency) — fine for a low-stakes PIN, not intended as enterprise-grade auth.

### Roles: three account types

- **Admin (owner):** full visibility into everything the business does — every page, including Settings.
- **Manager:** view + insert everywhere except Settings — Dashboard, POS, Queue, Appointments, Customers, Staff, Inventory, Reports, Expenses. Can add **and delete** Appointments, Staff, and Inventory. Deletes on Staff and Inventory are soft deletes (an `is_active` flag) so sales/commission history tied to them is never lost — they just drop off the active roster/catalog. Appointment deletes are permanent (nothing else depends on them).
- **Secretary:** front-desk only — POS, Queue, Appointments, Customers. Logs in straight to POS to record daily sales and bookings. Has **no delete access anywhere**, including on Appointments (the delete button simply doesn't render for this role) — matching their job of inserting daily data, not correcting or removing it.

Barbers, beauticians, and receptionists are real records (needed for POS attribution, commissions, and specialties) but **don't log into the app** — only Admin, Manager, and Secretary accounts do. When registering a barber/beautician/receptionist from the Staff page, no PIN is requested; when registering a manager or secretary, a PIN is required.

This is enforced client-side in `auth-guard.js` (hides nav links + redirects on direct navigation to pages a role can't reach, and exposes a `window.barberOSCanDelete` flag pages check before rendering delete controls) — matching the PIN system's overall security level, not a substitute for real server-side authorization if this goes into production with real money.

### Transactions (Owner-only add/delete)

The Reports page has a "Transactions" list showing every individual sale for the currently selected range, alongside the existing aggregate reports. Only the Admin (owner) sees a delete button on each one — Manager and Secretary can view the list but not remove entries. Adding a transaction is just a normal sale through POS, available to whichever roles already have POS access (Owner, Manager, Secretary).

Deleting a transaction fully reverses everything it caused, not just the sale record: product stock is restored, any wallet payment is refunded back to the customer's balance, any loyalty points it earned are taken back, and if it closed out a queue entry, that entry is detached (not deleted) from the now-voided sale. All of this happens in a single database transaction — either the sale and every one of its consequences are undone together, or the delete fails and nothing changes.

### Customer Wallet (prepaid credit)

Customers can pre-pay cash now and use it for services later. From a customer's detail drawer on the Customers page, staff can "Top Up" their wallet — this is recorded as a `wallet_transactions` entry and increases `customers.wallet_balance`, but is **deliberately not counted as sales revenue**, since no service has been delivered yet (it's a liability, not income).

When the customer later gets a service, POS has a "Wallet" payment tab alongside M-Pesa/Cash/Card. Selecting it shows their current balance and warns if it's insufficient or if no customer is selected. On checkout, the balance check and deduction happen atomically in the same database transaction as the sale itself — if the balance is insufficient, the whole sale is rejected and nothing is partially recorded. A wallet-paid sale **is** counted as normal revenue (it shows up in Dashboard, Reports, commissions — everything — exactly like a cash or M-Pesa sale), since the service was actually delivered; only the payment method differs.

The wallet is always charged the server's own computed total (from the actual services/products/discount on the sale) — never a client-supplied payment amount — so the amount deducted can never drift from what the sale record itself says was owed.

The full top-up/payment history for each customer is visible in their detail drawer.

### Staff Attendance & Monthly Attendance Report

The Dashboard shows today's check-in/check-out status for every barber and beautician at a glance (reuses the same `attendance` data already recorded via the Clock In/Out buttons on the Staff page — no separate tracking to keep in sync). The "Generate Monthly Attendance Report" button, on that same card, jumps to Reports with the current calendar month pre-selected and immediately opens the print/PDF dialog for a check-in/check-out report only — staff name, role, date, check-in, check-out, and hours worked per shift, plus a total-hours-per-staff summary. It does not include sales, expenses, or commissions.

The general financial report (sales/expenses/commissions/profit) is still available from the Reports page itself via the Export Data section's "This Month" tab (or any other range) — that one is untouched, just no longer what the Dashboard shortcut produces.

### Sales Calendar

The Dashboard has a month-view calendar (below the main stats grid) showing each day's total sales and sale count at a glance — days with sales are highlighted, today is outlined, and clicking a day with sales shows the exact total and count. Prev/next buttons navigate between months. It reuses the existing `/api/reports/sales` daily-breakdown endpoint, so there's no separate data source to keep in sync.

### Barbers & Beauticians

Both are "service provider" staff — they get a row in the `barbers` table (specialties, commission rate, performance tracking) and show up together in the POS provider picker, the Staff page, and Reports. The Dashboard's **Staff Performance** panel ranks every barber and beautician by today's revenue, highest to lowest — not just a single "top performer."

**Star rating is earned automatically**, not set manually: it's `floor(lifetime services performed / 50) × 0.5`, so every 50 completed services earns half a star. The Staff page shows each provider's lifetime total services alongside their current rating and how many services remain until their next star.

### Login history

Every Admin/Manager/Secretary login and logout is recorded (`login_sessions` table) with a timestamp for each. **Only the Admin (owner) can see it** — the "Login History" panel on both the Dashboard and the Staff page is hidden from Manager and Secretary. This is separate from barber/beautician shift clock-in/out (which is about attendance for commission purposes, not app access).

### Services catalog

Services now have a `category` field (Cuts, Dyes, Spa, Waxing, Facial Scrubs, Full Facial, Massages) matching the shop's printed price list. POS groups service selection by category, and the Settings price list is grouped the same way, with a category field (autocompleted from existing categories) when adding a new service. The full 46-item starter catalog is seeded once via `migrate.js` — additive only, never overwrites services added manually afterward.

### Expenses

A dedicated Expenses page tracks rent, utilities, salaries, supplies, and other costs (category, description, amount, date), feeding into the profit report (`revenue − expenses − commissions`). Admin and Manager can add and delete expense entries.

### Security

- **XSS protection**: every place user-entered text (customer names, appointment notes, staff names, product/service names, expense descriptions, etc.) gets rendered back into the page is now HTML-escaped (`web/utils.js`). Previously this was inserted via `innerHTML` unescaped in several places — a customer typing a name like `<img src=x onerror=...>` at the walk-in queue could have run arbitrary JS for anyone viewing that page.
- **Login rate limiting**: the login endpoint is capped at 20 requests per 15 minutes per IP, and additionally locks a specific account for 15 minutes after 5 wrong PIN attempts on it — a 4-digit PIN is only 10,000 combinations, so this matters.
- **General API rate limiting**: 600 requests / 15 min per IP across the API, to blunt scraping/abuse.
- **Session expiry**: a browser session now expires after 12 hours and forces a fresh login, instead of lasting forever.
- **Security headers** via `helmet` (CSP, X-Frame-Options, X-Content-Type-Options, etc.), scoped to what this app actually loads — note the CSP explicitly allows inline scripts/styles/`onclick` handlers (`'unsafe-inline'`) since the app relies on them throughout; a stricter nonce-based CSP would be a further improvement but requires reworking every inline handler.

None of this replaces the fact that PIN-based auth with no server-side session/JWT is inherently lighter-weight than a real production auth system — treat it as appropriate for internal shop staff use, not for anything handling sensitive data at scale.

### Look & feel

- Sidebar icons are hand-drawn inline SVGs (no emoji) for a consistent, sleek look across every page.
- The Manager Login and Secretary Login screens (`login.html?group=manager|secretary`) use a barbershop-themed photo as a background wallpaper; Admin Login stays on the plain dark theme.
- Responsive breakpoints tuned for both small phones (≤480px: smaller sidebar, reduced padding/font sizes) and tablet/narrow-window sizes (≤860–960px depending on page: sidebar collapses to icon-only, multi-column layouts stack).
- The Style Gallery feature has been removed.

This is client-side gating, matching the PIN system's overall security level — not a substitute for real server-side authorization if this goes into production with real money.

### Staff registration & photos

Owners can register new staff from the Staff page (name, phone, role, PIN, and — for barbers — specialties and commission rate). Photos are uploaded as a file, read client-side, and stored as a base64 data URL directly in the database (`users.photo_url`) — no separate file storage needed, and it survives redeploys since it lives in Postgres rather than the app's ephemeral filesystem.

### Receipt printing

After a sale completes in POS, a printable receipt appears (shop name/address, items, total, payment method, footer message). "Print Receipt" opens the browser print dialog with a print-only stylesheet so just the receipt prints, not the rest of the page.

