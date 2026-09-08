-- ============================================================
-- BarberOS Database Schema
-- PostgreSQL 14+
-- Multi-branch ready: every operational table carries shop_id
-- ============================================================

CREATE TYPE user_role AS ENUM ('owner', 'manager', 'secretary', 'receptionist', 'barber', 'beautician');
CREATE TYPE payment_method AS ENUM ('mpesa', 'cash', 'card', 'split', 'wallet');
CREATE TYPE payment_status AS ENUM ('pending', 'confirmed', 'failed', 'refunded');
CREATE TYPE appointment_status AS ENUM ('scheduled', 'confirmed', 'completed', 'cancelled', 'no_show');
CREATE TYPE queue_status AS ENUM ('waiting', 'called', 'in_service', 'completed', 'left');
CREATE TYPE discount_type AS ENUM ('percentage', 'fixed');
CREATE TYPE commission_type AS ENUM ('flat_percent', 'tiered', 'per_service');
CREATE TYPE notification_channel AS ENUM ('sms', 'whatsapp', 'in_app');
CREATE TYPE notification_trigger AS ENUM (
  'queue_next', 'appointment_reminder', 'low_stock',
  'daily_summary', 'commission_payout', 'loyalty_earned'
);

-- ------------------------------------------------------------
-- Shops (multi-branch root)
-- ------------------------------------------------------------
CREATE TABLE shops (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  location          TEXT,
  phone             TEXT,
  logo_url          TEXT,
  opening_time      TIME,
  closing_time      TIME,
  mpesa_till        TEXT,
  mpesa_paybill     TEXT,
  mpesa_api_key     TEXT,           -- store encrypted at rest
  receipt_footer    TEXT,
  subscription_tier TEXT DEFAULT 'trial',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Users (staff accounts: owner/manager/receptionist/barber)
-- ------------------------------------------------------------
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  full_name     TEXT NOT NULL,
  phone         TEXT NOT NULL,
  email         TEXT,
  password_hash TEXT NOT NULL,
  pin_hash      TEXT,
  role          user_role NOT NULL,
  photo_url     TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, phone)
);

-- ------------------------------------------------------------
-- Barbers (extends users where role = 'barber')
-- ------------------------------------------------------------
CREATE TABLE barbers (
  id                 UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  shop_id            UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  specialties        TEXT[],
  bio                TEXT,
  commission_type    commission_type NOT NULL DEFAULT 'flat_percent',
  commission_rate    NUMERIC(5,2) NOT NULL DEFAULT 40.00,  -- % of service revenue
  is_available       BOOLEAN NOT NULL DEFAULT true,        -- toggled for queue auto-assign
  rating_avg         NUMERIC(2,1) DEFAULT 0
);

CREATE TABLE barber_working_hours (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id   UUID NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sunday
  start_time  TIME NOT NULL,
  end_time    TIME NOT NULL
);

CREATE TABLE attendance (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barber_id   UUID NOT NULL REFERENCES barbers(id) ON DELETE CASCADE,
  shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  clock_in    TIMESTAMPTZ NOT NULL,
  clock_out   TIMESTAMPTZ
);

-- ------------------------------------------------------------
-- Login sessions: audit trail of when Admin/Manager accounts
-- logged in and out of the app (separate from barber clock-in/out,
-- which is about shift attendance for commission purposes)
-- ------------------------------------------------------------
CREATE TABLE login_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  login_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  logout_at   TIMESTAMPTZ
);

-- ------------------------------------------------------------
-- Customers
-- ------------------------------------------------------------
CREATE TABLE customers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  full_name      TEXT NOT NULL,
  phone          TEXT,
  photo_url      TEXT,
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  wallet_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, phone)
);

-- ------------------------------------------------------------
-- Customer wallet: prepaid credit. Topping up is NOT revenue (it's a
-- liability — cash held on the customer's behalf until they redeem it for
-- an actual service). Redeeming wallet balance to pay for a sale IS revenue,
-- recorded as a normal sale with payment method 'wallet', and logged here
-- as a negative entry against the same balance.
-- ------------------------------------------------------------
CREATE TABLE wallet_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  shop_id       UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('topup', 'payment', 'refund', 'adjustment')),
  amount        NUMERIC(10,2) NOT NULL, -- positive for topup/refund, negative for payment/deduction
  balance_after NUMERIC(10,2) NOT NULL,
  sale_id       UUID, -- FK added below, once the sales table exists
  notes         TEXT,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE loyalty_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id   UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  points_change INTEGER NOT NULL,          -- positive = earned, negative = redeemed
  reason        TEXT,
  sale_id       UUID,                      -- nullable FK to sales, added after sales table
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Services & Products catalog
-- ------------------------------------------------------------
CREATE TABLE services (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id        UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  category       TEXT,
  price          NUMERIC(10,2) NOT NULL,
  duration_mins  INTEGER NOT NULL DEFAULT 30,
  is_active      BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE suppliers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id    UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT
);

CREATE TABLE products (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id           UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  category          TEXT,
  unit              TEXT DEFAULT 'each',
  cost_price        NUMERIC(10,2) NOT NULL DEFAULT 0,
  sell_price        NUMERIC(10,2) NOT NULL,
  stock_quantity    INTEGER NOT NULL DEFAULT 0,
  low_stock_threshold INTEGER NOT NULL DEFAULT 5,
  supplier_id       UUID REFERENCES suppliers(id),
  is_active         BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE purchases (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  supplier_id  UUID REFERENCES suppliers(id),
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_cost   NUMERIC(10,2) NOT NULL,
  notes        TEXT
);

CREATE TABLE purchase_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id),
  quantity    INTEGER NOT NULL,
  unit_cost   NUMERIC(10,2) NOT NULL
);

-- ------------------------------------------------------------
-- Appointments
-- ------------------------------------------------------------
CREATE TABLE appointments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id  UUID NOT NULL REFERENCES customers(id),
  barber_id    UUID REFERENCES barbers(id),
  scheduled_at TIMESTAMPTZ NOT NULL,
  status       appointment_status NOT NULL DEFAULT 'scheduled',
  source       TEXT DEFAULT 'walk_in_desk',  -- 'online_booking' | 'walk_in_desk' | 'phone'
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE appointment_services (
  appointment_id UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  service_id     UUID NOT NULL REFERENCES services(id),
  PRIMARY KEY (appointment_id, service_id)
);

-- ------------------------------------------------------------
-- Queue (walk-in waiting bench) — the flagship feature
-- ------------------------------------------------------------
CREATE TABLE queue_entries (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  queue_number INTEGER NOT NULL,           -- resets daily per shop
  customer_id  UUID REFERENCES customers(id),   -- nullable: anonymous walk-ins allowed
  customer_name_snapshot TEXT NOT NULL,    -- captured even if no customer profile
  barber_id    UUID REFERENCES barbers(id),     -- nullable until assigned
  status       queue_status NOT NULL DEFAULT 'waiting',
  joined_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  called_at    TIMESTAMPTZ,
  started_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  sale_id      UUID                        -- FK added after sales table
);

CREATE TABLE queue_entry_services (
  queue_entry_id UUID NOT NULL REFERENCES queue_entries(id) ON DELETE CASCADE,
  service_id     UUID NOT NULL REFERENCES services(id),
  PRIMARY KEY (queue_entry_id, service_id)
);

-- ------------------------------------------------------------
-- Sales (POS transactions)
-- ------------------------------------------------------------
CREATE TABLE sales (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id     UUID REFERENCES customers(id),
  barber_id       UUID NOT NULL REFERENCES barbers(id),
  queue_entry_id  UUID REFERENCES queue_entries(id),
  subtotal        NUMERIC(10,2) NOT NULL,
  discount_type   discount_type,
  discount_value  NUMERIC(10,2) DEFAULT 0,
  discount_reason TEXT,
  total           NUMERIC(10,2) NOT NULL,
  created_by      UUID NOT NULL REFERENCES users(id),  -- who rang up the sale
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE queue_entries ADD CONSTRAINT fk_queue_sale FOREIGN KEY (sale_id) REFERENCES sales(id);
ALTER TABLE loyalty_transactions ADD CONSTRAINT fk_loyalty_sale FOREIGN KEY (sale_id) REFERENCES sales(id);
ALTER TABLE wallet_transactions ADD CONSTRAINT fk_wallet_sale FOREIGN KEY (sale_id) REFERENCES sales(id);

CREATE TABLE sale_line_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id     UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  item_type   TEXT NOT NULL CHECK (item_type IN ('service', 'product')),
  service_id  UUID REFERENCES services(id),
  product_id  UUID REFERENCES products(id),
  quantity    INTEGER NOT NULL DEFAULT 1,
  unit_price  NUMERIC(10,2) NOT NULL,
  line_total  NUMERIC(10,2) NOT NULL
);

CREATE TABLE sale_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id         UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method          payment_method NOT NULL,
  amount          NUMERIC(10,2) NOT NULL,
  status          payment_status NOT NULL DEFAULT 'pending',
  mpesa_receipt   TEXT,             -- Daraja transaction reference, if method = mpesa
  mpesa_phone     TEXT,
  confirmed_at    TIMESTAMPTZ
);

-- ------------------------------------------------------------
-- Commissions (calculated per sale, payout-ready)
-- ------------------------------------------------------------
CREATE TABLE commissions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id       UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  barber_id     UUID NOT NULL REFERENCES barbers(id),
  amount        NUMERIC(10,2) NOT NULL,
  is_paid_out   BOOLEAN NOT NULL DEFAULT false,
  paid_out_at   TIMESTAMPTZ
);

-- ------------------------------------------------------------
-- Expenses
-- ------------------------------------------------------------
CREATE TABLE expenses (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,      -- rent, utilities, salaries, supplies, other
  description TEXT,
  amount      NUMERIC(10,2) NOT NULL,
  incurred_at DATE NOT NULL,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Notifications (service log — not a page, a dependency)
-- ------------------------------------------------------------
CREATE TABLE notifications (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('customer', 'barber', 'owner')),
  recipient_id UUID,                     -- customer_id or user_id depending on recipient_type
  channel      notification_channel NOT NULL,
  trigger_type notification_trigger NOT NULL,
  message      TEXT NOT NULL,
  sent_at      TIMESTAMPTZ,
  status       TEXT DEFAULT 'pending'    -- pending | sent | failed
);

-- ------------------------------------------------------------
-- Indexes for the hot paths: queue, POS lookups, reporting
-- ------------------------------------------------------------
CREATE INDEX idx_queue_shop_status ON queue_entries(shop_id, status);
CREATE INDEX idx_sales_shop_created ON sales(shop_id, created_at);
CREATE INDEX idx_appointments_shop_scheduled ON appointments(shop_id, scheduled_at);
CREATE INDEX idx_customers_shop_phone ON customers(shop_id, phone);
CREATE INDEX idx_products_shop_stock ON products(shop_id, stock_quantity);
CREATE INDEX idx_commissions_barber_paid ON commissions(barber_id, is_paid_out);
CREATE INDEX idx_login_sessions_shop_login ON login_sessions(shop_id, login_at DESC);
CREATE INDEX idx_wallet_transactions_customer ON wallet_transactions(customer_id, created_at DESC);

-- ------------------------------------------------------------
-- Example: daily queue number reset (application-level logic)
-- BarberOS assigns queue_number = COUNT(*) + 1 of today's entries
-- for that shop_id, rather than a global sequence, so numbering
-- restarts at 1 each morning.
-- ------------------------------------------------------------
