# BarberOS — Product Specification

**A point-of-sale, booking, and shop-management system for barbershops and salons in Kenya.**

---

## 1. Vision & Problem

Most Kenyan barbershops run on a notebook, a till, and word of mouth. Revenue tracking is manual, walk-ins are managed by shouting across the room, stock runs out without warning, and barbers have no visibility into their own commission until payday. BarberOS replaces the notebook with a single system that handles the walk-in queue, bookings, sales, staff commissions, and inventory — built around how Kenyan barbershops actually operate, not around a generic Western salon-software template.

**Primary user:** the shop owner or receptionist, on a phone or a shared tablet at the front desk.
**Secondary users:** barbers (view their own queue, sales, commission) and, eventually, customers (book online, join the queue remotely).

---

## 2. Core Modules

### 2.1 Dashboard
The owner's daily read on shop health at a glance.
- Today's revenue, with % change vs. yesterday and vs. the same weekday last week
- Services completed today, customers served today
- Live queue count ("3 waiting")
- Upcoming appointments (next 3–5)
- Low-stock products needing reorder
- 7/30-day sales trend chart
- Top-performing barber (by revenue or by service count — configurable)

### 2.2 POS / New Sale
The core transaction flow, designed for speed — a barber should be able to close a sale in under 20 seconds.
- Select or quick-add customer (search by name/phone, or skip for anonymous walk-in)
- Select barber (defaults to the barber who called the customer from the queue, if applicable)
- Select one or more services (multi-select, running total updates live)
- Add retail products to the sale (pomade, oil, etc.)
- Apply a discount (percentage or fixed amount, with a reason code for reporting)
- Choose payment method: **M-Pesa** (STK push or manual till/paybill entry), **Cash**, **Card**, or **Split payment**
- Generate and share a receipt (SMS, WhatsApp, or print if a receipt printer is connected)
- On completion: automatically closes the queue entry (if the sale came from the queue) and logs commission for the barber

### 2.3 Appointments
- Calendar view (day/week) per barber or shop-wide
- Walk-in queue (see 2.3.1 below — related but distinct from scheduled bookings)
- Online booking (customer-facing link/page, no app required)
- Barber availability management (working hours, breaks, time off)
- Automated SMS/WhatsApp reminders (e.g., 2 hours before appointment)

#### 2.3.1 Walk-In Queue — *flagship feature*
This is the single highest-leverage feature for a Kenyan barbershop, where the majority of traffic is walk-in, not booked.

**Flow:**
1. Receptionist adds a walk-in: customer name, service(s), preferred/assigned barber → entry appears on the **Waiting Bench**
2. Entry shows: queue number, customer name, service(s), assigned barber, wait time (live-updating)
3. When a barber finishes their current customer, they mark themselves "free" — the system notifies the barber (in-app + SMS) that their next customer is ready
4. Customer gets an optional SMS/WhatsApp notification when they're next ("You're next at Kinyozi Ndogo — please head to Kevin's chair")
5. Tapping "Start Service" moves the entry to POS with customer/barber/services pre-filled
6. If no barber is specified, the system can auto-assign to the next available barber (round-robin or least-busy)

**Why it matters:** removes the need for a receptionist to physically track who's next, reduces walk-away rate (customers who leave because they don't know their wait time), and gives owners queue-length data they've never had before.

### 2.4 Customers
- Customer profiles (name, phone, photo optional)
- Full visit history (date, barber, services, amount spent)
- Favorite/most-booked services
- Lifetime spending total
- Loyalty points (earned per visit/spend, redeemable for discounts or a free service)

### 2.5 Staff
- Barber profiles (photo, specialties, bio for online booking page)
- Commission structure (flat %, tiered by revenue, or per-service rate)
- Attendance (clock in/out, tracked against scheduled working hours)
- Working hours & availability (feeds into appointment booking and queue auto-assignment)
- Performance (revenue, services count, average rating, repeat-customer rate)

### 2.6 Inventory
- Product catalog (name, category, unit, cost price, sell price)
- Stock levels per product, with automatic decrement on sale (for retail items sold at POS)
- Purchases (recording stock received from suppliers)
- Suppliers (contact info, purchase history)
- Low-stock alerts (configurable threshold per product)

### 2.7 Expenses *(added — see note below)*
- Log recurring and one-off expenses: rent, utilities, salaries, supplies, licensing
- Categorized for reporting, so "profit" isn't just "revenue" but revenue minus real costs

> **Note:** the original module list had Expenses only inside Reports. It's promoted to its own module here because a barbershop's real profitability can't be tracked from sales data alone — rent and staff costs are usually the two biggest line items.

### 2.8 Reports
- Sales (by day/week/month, by barber, by service)
- Expenses
- Profit (revenue − expenses − commissions)
- Barber commissions (payout-ready summary)
- Popular services (ranked by count and by revenue)
- Customer growth (new vs. returning, over time)

### 2.9 Notifications *(added — was implied but undefined)*
A cross-cutting module, not a page customers see, but a service every other module depends on.
- Channels: in-app, SMS, WhatsApp (via Africa's Talking or Twilio/WhatsApp Business API)
- Triggers: queue "you're next," appointment reminders, low-stock alerts, end-of-day sales summary to the owner, commission payout notices to barbers

### 2.10 Settings
- Shop profile (name, logo, location, hours) — supports multiple branches if the shop expands
- Services & prices (the master service/price list used across POS and booking)
- M-Pesa settings (till number, paybill, API credentials for STK push)
- Receipt settings (logo, footer message, tax details if applicable)
- User permissions (owner, manager, receptionist, barber — each with different access)
- Subscription (BarberOS's own billing, if sold as SaaS)

### 2.11 AI Assistant *(scoped)*
Kept deliberately narrow for v1 rather than a vague "AI does everything" promise:
- Natural-language queries over the owner's own data: *"How did Kevin do last week?"* / *"What's my slowest day?"*
- Demand forecasting for stock reorder timing, based on historical usage
- Churn flagging: surfaces customers who haven't returned in 60+ days, for a win-back SMS campaign

---

## 3. Kenya-Specific Requirements

These aren't optional polish — they're what makes the difference between a system that gets adopted and one that gets abandoned after a week.

- **M-Pesa first-class support:** STK Push for customer-initiated payment at checkout, a callback handler for payment confirmation, and a reconciliation view for failed/timed-out transactions. Cash and card are supported but M-Pesa is the primary rail.
- **SMS/WhatsApp over push notifications:** not every customer has the shop's app (or a smartphone at all). Queue and appointment notifications should default to SMS via a local aggregator (Africa's Talking is the common choice) with WhatsApp as an upgrade path.
- **Offline resilience:** POS and queue must keep working through a connectivity drop (common with power/network interruptions) and sync once back online. This likely means a local-first data layer with background sync, not a pure server-dependent web app.
- **Multi-branch readiness:** even a single-shop MVP should model `shop_id` on every table from day one — retrofitting multi-branch later means a painful migration.

---

## 4. Recommended Architecture

```
BarberOS
│
├── Admin Dashboard      (owner/manager web app)
├── POS                  (front-desk transaction flow)
├── Appointments          (calendar + online booking page)
├── Queue                (walk-in waiting bench)
├── Customers
├── Staff
├── Inventory
├── Expenses
├── Reports
├── Notifications         (SMS/WhatsApp service layer)
└── AI Assistant          (scoped query/insight layer)
```

**Suggested stack:**
- **Frontend:** React (web-first, responsive down to mobile — front-desk devices are often a single shared tablet or phone)
- **Backend:** Node.js/Express or similar, REST or GraphQL API
- **Database:** PostgreSQL (relational integrity matters for sales/inventory/commissions — see `schema.sql`)
- **Offline layer:** local-first cache (e.g., IndexedDB via a sync library) for POS and Queue specifically
- **Payments:** M-Pesa Daraja API (STK Push, C2B, transaction status)
- **Messaging:** Africa's Talking (SMS) with WhatsApp Business API as a phase 2 upgrade
- **Hosting:** cloud VPS or managed Postgres + app hosting in a region with low latency to Kenya (or a local provider)

---

## 5. MVP Roadmap

**Phase 1 — Core loop (get one shop live)**
Dashboard, POS, Queue, Customers (basic), Services & pricing settings, M-Pesa payment.

**Phase 2 — Retention & staff**
Appointments (calendar + reminders), Staff (commission + attendance), Inventory, Loyalty points.

**Phase 3 — Insight & scale**
Reports (full suite), Expenses, Notifications as a formal service (WhatsApp), multi-branch support, AI Assistant.

---

## 6. Success Metrics

- % of transactions logged through BarberOS vs. still handled off-system
- Average queue wait time (should decrease as the feature reduces walk-aways)
- Barber commission disputes (should trend to zero once commission is system-calculated)
- Stock-out incidents per month (should decrease with low-stock alerts)
- Owner's time spent reconciling books at month-end (should collapse from hours to minutes)
