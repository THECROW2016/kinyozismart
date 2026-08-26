-- ============================================================
-- BarberOS seed data — the shop record plus its two login
-- accounts (Owner, Manager). No demo barbers, services,
-- products, customers, or transactions: this is the baseline
-- for a real handover, not a demo dataset. Add real staff,
-- services, and inventory through the app itself once live.
-- ============================================================

INSERT INTO shops (id, name, location, phone, opening_time, closing_time, receipt_footer)
VALUES ('11111111-1111-1111-1111-111111111111', 'Kinyozi Management System', 'Ronald Ngala St, Nairobi CBD', '0700111222', '08:00', '20:00', 'Asante kwa kutuchagua!');

INSERT INTO users (id, shop_id, full_name, phone, password_hash, role) VALUES
('21111111-1111-1111-1111-111111111199', '11111111-1111-1111-1111-111111111111', 'Shop Owner', '0722000000', 'x', 'owner');

-- The Manager account is created by backend/migrate.js (it needs to compute
-- a PIN hash, which plain SQL can't do), not seeded here.
