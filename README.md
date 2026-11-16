# Station ERP — Sales & Profit Governance

A lightweight ERP for petrol stations to track sales, stock, VAT and platform profit
with full auditability. Fully configurable per station — products, tank balances,
payment methods and profit rules are set up for each site.

## Features

- **Manual sale entry** — product, litres, unit price, payment method, shift/date
- **Product catalog** — DIESEL, MOGAS 95, MOGAS 91 (configurable per station)
- **Stock tracking** — balances, receipt entry, movement ledger, shortage blocked at sale time
- **Profit rules** — fully dynamic, admin-configured baisa/litre per product × payment method.
  No seeded/hardcoded defaults: a sale requires an active rule for the selected product and
  payment method. Changes require a reason and are audited. Admins can add, edit,
  activate/deactivate and remove rules.
- **Manual profit override** — per sale line, reason required, fully audited
- **Reports & exports** — daily summary, profit by product × payment, stock ledger,
  stock VAT split, VAT statement, CSV and PDF
- **Access control** — ADMIN / MANAGER / CASHIER / VIEWER
- **Audit log** — every sale, void, rule change, override, stock receipt

## Formula

```
profit_per_line (OMR) = (litres × profit_baisa) ÷ 1000
line_total_incl       = litres × unit_price_incl
line_total_excl       = line_total_incl ÷ (1 + VAT/100)     (Oman VAT = 5%)
line_vat              = line_total_incl − line_total_excl
```

Money is stored/displayed at 6 decimals; litres at 3.

## Stack

- **Backend**: Express + built-in `node:sqlite` (Node 22.5+/24+), JWT auth, CSV/PDF exports — pure JS, no native builds. MariaDB/MySQL supported via `DB_TYPE=mysql`.
- **Frontend**: React 18 + Vite + React Router, plain CSS design system

## Quick start

```bash
# Backend (http://localhost:4000) — serves the API and the built SPA
cd erp-backend && npm install && npm run dev

# Frontend dev server (http://localhost:5173) — proxies /api to the backend
cd erp-frontend && npm install && npm run dev
```

Or double-click **`Start ERP.bat`** (Windows) to launch/manage the local app at
`http://localhost:4000`.

The database is created automatically on first run (SQLite at `erp-backend/data/erp.db`).
Delete that file and restart to reset to a clean baseline (catalog, users, site, tanks;
no sales, movements, audit history or profit rules).

Demo logins (first login forces a password change):

| Role     | Login    | Permissions |
|----------|----------|-------------|
| ADMIN    | admin    | everything, manage profit rules, manage users |
| MANAGER  | manager  | sales, overrides, void sales, stock receipts |
| CASHIER  | cashier  | sales entry only |
| VIEWER   | viewer   | read-only reports/audit |

## Scripts

Backend:

```bash
npm test          # profit/VAT formula unit tests
npm run test:mysql # optional MySQL/MariaDB integration test (needs MYSQL_TEST=1)
npm run dev       # start API on :4000
npm run build     # build the SPA into erp-backend/public
npm run dump      # export SQLite data to data/bootstrap.json
```

Frontend:

```bash
npm run dev       # dev server on :5173
npm run build     # production build
npm test          # jsdom smoke test
```

## API overview

```
POST /api/auth/login
POST /api/auth/change-password
GET  /api/catalog
POST /api/sales                    (create sale; requires active profit rule + stock)
GET  /api/sales?fromDate=&toDate=  (paginated with ?page=&limit=)
POST /api/sales/:id/void           (manager+, restores stock)
GET  /api/stock/balance
POST /api/stock/receipt            (manager+)
GET  /api/stock/ledger             (paginated with ?page=&limit=)
GET  /api/reports/daily?date=
GET  /api/reports/profit?fromDate=&toDate=
GET  /api/reports/summary?fromDate=&toDate=
GET  /api/reports/stock-entries?fromDate=&toDate=
GET  /api/reports/vat-statement?fromDate=&toDate=
GET  /api/profit-rules
POST /api/profit-rules             (admin, reason required)
PUT  /api/profit-rules/:id         (admin, reason required)
DELETE /api/profit-rules/:id       (admin, reason required)
GET  /api/audit/override
GET  /api/audit/log
GET  /api/export/csv/:kind
GET  /api/export/pdf/:kind
GET/POST /api/users                (admin)
```

## Layout

```
erp-backend/
  src/db.js          schema init + automatic baseline seeding
  src/db/            SQLite/MySQL adapters + schema/indexes
  src/profit.js      pure profit/VAT math (unit-tested)
  src/services.js    business logic + transactions + audit
  src/security.js    headers, CORS guard, rate limiting
  src/pdf.js         invoice/report/ledger PDFs
  src/server.js      Express API + auth + exports
erp-frontend/
  src/pages/         Dashboard, SalesEntry, SalesList, Stock, Reports,
                     ProfitRules, Audit, Users, Login
```

## Security & deployment notes

- Set a strong `JWT_SECRET` in production (the app refuses to start with a weak/missing
  secret when `NODE_ENV=production`).
- Configure deployment values via environment variables (see `erp-backend/.env.example`).
  Never commit real `.env` files.
- The local SQLite database and runtime data live in `erp-backend/data/` and are gitignored.
- For MySQL/MariaDB use `DB_TYPE=mysql` plus `DB_HOST`, `DB_PORT`, `DB_USER`,
  `DB_PASSWORD`, `DB_NAME`; schema/indexes and the baseline seed are applied automatically.
