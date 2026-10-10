# Frontend ↔ backend ↔ database integration

Last verified: 2026-10-10, against MongoDB Atlas, backend on :4000, frontend (Vite) on :5173.

## Architecture as found

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 19, Vite 8, React Router 7, lucide-react | `frontend/`; JavaScript; oxlint |
| Backend | Node ≥ 20.19, Express 5, Mongoose 9, zod 4, pino | `backend/`; modular monolith (route → controller → service → repository) |
| Database | MongoDB Atlas (replica set — required for transactions) | Configured by `MONGODB_URI` in `backend/.env` |
| Auth | JWT (HS256, 8 h) in `Authorization: Bearer`; bcrypt passwords | Role re-read from the DB on every request |
| Dev wiring | Vite proxies `/api` → `http://localhost:4000` | No CORS in development, no backend URL in the bundle |

## Integration checklist

| Item | Status | Evidence |
|---|---|---|
| Backend starts and connects to Atlas | ✅ | `GET /api/health` → `db: connected` (direct and through the Vite proxy) |
| Seed creates repeatable demo data | ✅ | `npm run seed:dev` — idempotent; demo orders/stock created via real services |
| Login against the real backend | ✅ | Browser E2E: invalid credentials message, successful sign-in toast |
| Session survives a page refresh | ✅ | E2E: reload on order detail keeps session and data |
| Invalid/expired session → login | ✅ | E2E: tampered token → redirected with "Please sign in again" |
| Role-based navigation and route guards | ✅ | E2E: buyer has no Users/Buyers/Inventory; `/users` shows "No access" |
| Backend enforces roles (not just the UI) | ✅ | E2E: buyer `GET /api/users` → 403; RBAC matrix test (22 routes × 5 roles) |
| Buyer ownership isolation | ✅ | E2E: other company's order → 404 in UI and API; list shows own company only |
| Create order → DB → UI | ✅ | E2E: order created in UI, read back via a separate API session, persists after reload |
| Validation errors shown at the field | ✅ | E2E: server error "Too big…" under Quantity; client checks before sending |
| Cancel with confirmation, history updated | ✅ | E2E: confirm dialog → toast → status Cancelled → reason in history |
| Inventory receive → ledger → UI | ✅ | E2E: store keeper receives a lot; it appears in the lot list |
| Business-rule error surfaced | ✅ | E2E: over-large write-off → "Unable to save: at most 75.5 kg can be removed…" |
| Reconciliation from the UI | ✅ | E2E: "Stock verified" toast |
| Duplicate submissions | ✅ | Buttons disabled while busy; Idempotency-Key per action (backend replays retries) |
| Preview screens clearly labelled | ✅ | Non-dismissible "Preview — sample data" banner + "Preview" nav badge |
| Mobile layout | ✅ | 390 px: menu button opens the sidebar overlay; stepper scrolls sideways |
| No 5xx / no uncaught JS errors in E2E | ✅ | 0 server 5xx, 0 page errors (4xx entries in the console are the tests' deliberate failures) |

## Screen → API → database map

| Screen | Roles | Endpoints | Collections |
|---|---|---|---|
| Login | public | `POST /auth/login`, `GET /auth/me` | users |
| Dashboard (5 role variants) | all | `/orders`, `/inventory/yarn-summary`, `/yarn-lots`, `/buyers`, `/products`, `/users` (role-dependent) | orders, yarnLots, buyers, products, users |
| Orders list | all (buyer: own) | `GET /orders` | orders |
| Order detail + cancel/reject | all (buyer: own) | `GET /orders/:id`, `POST /orders/:id/cancel`, `POST /orders/:id/reject` | orders, auditLogs, idempotencyRecords |
| Order feasibility + confirm (on order detail) | SK, FM (view); ADMIN (view, confirm) | `GET /orders/:id/feasibility`, `POST /orders/:id/confirm` | orders, yarnLots, locks, auditLogs, idempotencyRecords |
| Place order (modal) | BUYER, ADMIN | `GET /products`, `GET /buyers` (admin), `POST /orders` | orders, counters, auditLogs, idempotencyRecords |
| Fabric catalog | all | `GET /products`, `POST /products` (admin) | products, auditLogs |
| Buyers | ADMIN | `GET /buyers`, `POST /buyers` | buyers, auditLogs |
| Yarn inventory | SK, FM, ADMIN | `/inventory/yarn-summary`, `/yarn-lots`, `POST /yarn-lots`, `/yarn-lots/:id/transactions`, `POST /yarn-lots/:id/adjustments`, `/inventory/reconciliation` | yarnLots, inventoryTransactions, auditLogs, idempotencyRecords |
| Users | ADMIN | `GET /users`, `POST /users`, `PATCH /users/:id/status` | users |
| Factory floor map, Production, QC, Dispatch, BOM, Stock ledger, Reports, Analytics, Settings | role-dependent | **none — sample data** (labelled Preview) | — |

## Start the application

```bash
# 1. Backend (terminal 1)
cd backend
npm ci
cp .env.example .env        # set MONGODB_URI, JWT_SECRET, SEED_PASSWORD
npm run seed:dev            # demo accounts and data (safe to repeat)
npm run dev                 # http://localhost:4000

# 2. Frontend (terminal 2)
cd frontend
npm ci
npm run dev                 # http://localhost:5173  (proxies /api to :4000)
```

Accounts: `docs/DEV_ACCOUNTS.md`.

## Verification commands

```bash
cd backend && npm test                  # unit + integration (in-memory replica set)
cd frontend && npx oxlint src && npm run build
```

## Known gaps (honest status)

- **Not built yet (backend):** machine-capacity part of feasibility, material reservation, machines,
  production, QC, finished goods, dispatch, invoicing, costing, audit-trail screen, offline sync.
  Their screens are previews with sample data and say so.
- **Database name:** the current `MONGODB_URI` has no database path, so data lives in Atlas's
  default `test` database. Add `/everest` before `?` to use a dedicated one (then re-run the seed).
- **Atlas start-up blip:** once during testing the backend's 5 s connection timeout expired while
  Atlas briefly had no reachable primary; a retry connected in 0.5 s. If `npm run dev` exits with
  "Could not connect to MongoDB", start it again.
- Unit tests for React components are not set up (no test runner in `frontend/`); the frontend is
  verified by lint, production build and the browser E2E run.

## Review walkthrough (≈ 10 minutes)

1. **Login & roles.** Open http://localhost:5173 → redirected to sign-in. Show a wrong password
   (generic message). Sign in as `buyer@everest.local`.
2. **Buyer dashboard.** Orders in progress with the stage stepper; nav shows only My Orders and Catalog.
3. **Place an order.** "Place order" → Navy Cotton Plain, 5,000 m, a date next month → success toast
   with the new `ORD-…` number → order detail with stepper and history. Refresh: still there.
4. **Validation.** Place order with 2,000,000 m → server error shown under the field, no order created.
5. **Ownership.** Sign in as `buyer2@everest.local` → only Tiruppur's orders. (Optional: paste a
   BUY-DEV order URL → "Order not found".)
6. **Admin view.** Sign in as `admin@everest.local` → KPIs, orders awaiting confirmation (earliest
   deadline first), yarn demand vs stock, "What is live". Open the buyer's order → Reject with a reason.
7. **Inventory.** Yarn inventory → Receive yarn (new lot) → success toast → Lots tab → Ledger.
   Adjust a lot by more than it holds → "Unable to save…" (business rule). Run reconciliation →
   "Stock verified".
8. **Store keeper / floor / QC.** Sign in as each to show their dashboards: store sees cost, floor
   sees quantities without cost, QC sees the honest "no inspections yet" state.
9. **Security.** As the buyer, open `/users` → "No access"; the API itself answers 403.
10. **Previews.** Open Factory Floor Map → the banner states it is sample data and not connected.
