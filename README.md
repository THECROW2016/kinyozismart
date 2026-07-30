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

## Status

Early-stage: product spec, schema, and static UI mockups. No backend implementation yet.
