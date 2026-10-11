# Everest Textile Mills

A manufacturing system for a textile mill that links the whole flow in one place:

**Yarn → Order → Production → Machine → QC → Finished goods → Dispatch → Invoice → Cost → Profit**

Built for the Odoo × NMIT 2026 hackathon from the *Textile Manufacturing System* problem statement
([`docs/Textile_Manufacturing_System.pdf`](docs/Textile_Manufacturing_System.pdf)).

![Everest Textile Mills dashboard](docs/Screenshot%20(3010).png)

## The problem

Everest Textile Mills buys yarn, spins, weaves and dyes it, checks the fabric for defects and sells
finished rolls to buyers. Today stock is tracked by hand, machine and order status means walking the
floor, QC is on paper, buyers phone for updates, wages are written up manually, and nobody knows the
actual cost of a roll. This system replaces that with one connected record.

## What it does

| Area | Highlights |
|---|---|
| **Yarn inventory** | Receive yarn lots by material and colour, append-only stock ledger, adjustments, reconciliation |
| **Orders** | Buyer companies, fabric catalog, order lifecycle with status history, buyers see only their own orders |
| **Feasibility** | Explainable material and deadline checks before an order is confirmed; no double-promising yarn |
| **Material reservation** | Reserve (FIFO or chosen lots), issue to production, return, release on cancel |
| **Machines** | Registry, floor map, maintenance, problems and downtime |
| **Production** | Production runs, roll output, production report by machine, shift and day, "today at the mill" |
| **QC & traceability** | Signed inspections, rework and rejection; trace any roll to its order, run, machine and yarn lots |
| **Dispatch & invoices** | Signed dispatch, GST invoices, buyer payments, due dates and receivables |
| **Costing & finance** | Actual material and machine-hour cost per order, profit, month-end statement |
| **Workers** | Attendance and wages (full and half days) |
| **Audit** | Append-only audit trail with role-based visibility and corrections; buyer order timeline |
| **Offline & realtime** | Offline event queue with replay on reconnect; live updates over Socket.IO |
| **Insights** | Rules-based delivery-risk flags and recommendations |

### Roles

`ADMIN`, `STORE_KEEPER`, `FLOOR_MANAGER`, `QC_INSPECTOR` and `BUYER`. Each role sees only what it
needs: for example, prices are hidden from floor roles and a buyer sees only their own company's
orders.

## Tech stack

| Layer | Stack |
|---|---|
| Backend | Node.js ≥ 20.19, Express 5, MongoDB (Mongoose, multi-document transactions), Zod, JWT, Socket.IO, Pino |
| Frontend | React 19, Vite, React Router, Recharts, Dexie (IndexedDB for offline), Socket.IO client |
| Tests | Jest + Supertest against an in-memory MongoDB replica set; Node test runner on the frontend |

## Project layout

```
backend/    Express API — route → controller → service → model (business rules live in services)
frontend/   React + Vite single-page app
docs/       Data model, integration notes, phase-by-phase feature docs, progress log
scripts/    Utility scripts
```

## Getting started

### Requirements

- Node.js **20.19 or newer**
- A MongoDB **replica set** (any MongoDB Atlas cluster, including the free tier, is one). A standalone
  `mongod` will not work because stock changes use transactions.

### 1. Backend

```bash
cd backend
npm ci
cp .env.example .env      # set MONGODB_URI, JWT_SECRET, SIGNING_KEY_ENCRYPTION_KEY, SEED_PASSWORD
npm run seed:dev          # optional: demo users, buyers, products, yarn and orders
npm run dev               # http://localhost:4000
```

Generate the secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"      # SIGNING_KEY_ENCRYPTION_KEY
```

Every variable is documented in [`backend/.env.example`](backend/.env.example) and
[`backend/README.md`](backend/README.md).

### 2. Frontend

```bash
cd frontend
npm ci
npm run dev               # http://localhost:5173
```

In development Vite forwards `/api` and `/socket.io` to the backend on port 4000, so no extra
configuration is needed. See [`frontend/.env.example`](frontend/.env.example) to change that.

### 3. Sign in

`npm run seed:dev` creates one account per role (`admin@`, `store@`, `floor@`, `qc@`, `buyer@`,
`buyer2@everest.local`), all using the `SEED_PASSWORD` from your `backend/.env`. Details in
[`docs/DEV_ACCOUNTS.md`](docs/DEV_ACCOUNTS.md). The seed refuses to run in production; use
`npm run bootstrap:admin` there to create the first admin.

## Scripts

| Where | Command | What it does |
|---|---|---|
| backend | `npm run dev` | API in watch mode |
| backend | `npm start` | Production start |
| backend | `npm test` | Full Jest suite (first run downloads a `mongod` binary) |
| backend | `npm run seed:dev` | Demo data (development only) |
| backend | `npm run bootstrap:admin` | First admin account (works in production) |
| frontend | `npm run dev` | Vite dev server |
| frontend | `npm run build` | Production build into `frontend/dist` |
| frontend | `npm run lint` | Oxlint |
| frontend | `npm test` | Frontend unit tests |

## Documentation

- [`docs/DATABASE.md`](docs/DATABASE.md) — data model and order lifecycle
- [`docs/INTEGRATION.md`](docs/INTEGRATION.md) — how the frontend and backend fit together
- [`docs/SIGNATURES.md`](docs/SIGNATURES.md) — digital signatures for QC and dispatch
- [`docs/PROGRESS.md`](docs/PROGRESS.md) — phase status and test counts
- [`docs/features/`](docs/features) — one note per feature phase
- [`backend/README.md`](backend/README.md) — API setup, environment and endpoint contract

## License

See [`LICENSE`](LICENSE).
