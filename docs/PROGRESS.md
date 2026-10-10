# Backend progress

Last updated: 2026-10-10

## Branch policy

**All backend work lives on `feature/backend`** (owner's decision, 2026-10-10). No new branches are
created. Phases 2 and 3 were developed on `feature/backend-auth` and `feature/backend-inventory` and
merged into `feature/backend`; those two branches are kept (not deleted) but are no longer used.

## Phase status

| # | Phase | Status | Branch | PR | Tests |
|---|---|---|---|---|---|
| 1 | Foundation | ✅ Done | `feature/backend` | #3 (merged to `main`) | 75 |
| 2 | Auth & RBAC | ✅ Done, on `feature/backend` | `feature/backend` | via `feature/backend` | 270 |
| — | Domain model (`docs/DATABASE.md`) | ✅ Done (D1, D2, D5 confirmed; D3, D4, D6–D8 pending) | `feature/backend` | via `feature/backend` | — |
| 3 | Yarn inventory | ✅ Done, on `feature/backend` | `feature/backend` | via `feature/backend` | 439 |
| 5 | Buyers, catalog, orders (+ ownership) — built before 4 (D5) | ✅ Done, merged to `main` | `feature/backend` | via `feature/backend` | 621 |
| 6 | Feasibility (material + deadline) and confirmation — built before 4 | ✅ Done, pushed | `feature/backend` | via `feature/backend` | 671 |
| — | Audit fixes; list filters and edit actions | ✅ Done, pushed | `feature/backend` | via `feature/backend` | 783 |
| 4 | Material reservation (reserve, issue, return, release) | ✅ Done, pushed | `feature/backend` | via `feature/backend` | 845 |
| 7 | Machines (registry, maintenance, problems, downtime; D4 confirmed) | ✅ Done, pushed | `feature/backend` | via `feature/backend` | 941 |
| 8 | Production runs and roll output (D3 single stage) | ✅ Done, pushed | `feature/backend` | via `feature/backend` | 1019 |
| 9 | Roll traceability (rolls are recorded since Phase 8; traceability views, labels) | ⏳ Next | | | |
| 10 | QC | Not started | | | |
| 11 | Finished goods | Not started | | | |
| 12 | Dispatch | Not started | | | |
| 13 | Audit trail (query API; entries already written since Phase 3) | Not started | | | |
| 14 | Costing | Not started | | | |
| 15 | Offline sync | Not started | | | |
| 16 | Realtime | Not started | | | |
| 17 | Intelligence | Not started | | | |

## Phase 3 — what is done

- `YarnLot` (integer grams, computed availability) and the append-only `InventoryTransaction` ledger.
- Repository layer with guarded atomic balance updates.
- `executeIdempotent()` + `Idempotency-Key` header for every stock mutation; per-actor keys.
- Append-only `AuditLog` written inside each business transaction (`MATERIAL_RECEIVED`, `STOCK_ADJUSTED`).
- Endpoints: receive, list, get, ledger, catalog summary, admin adjustments, reconciliation report.
- Cost visible to STORE_KEEPER/ADMIN only.
- Docs: `docs/features/phase-03-inventory.md`, `docs/learning/phase-03-inventory.md`, README contract.

## Phase 5 — what is done

- `Buyer` (company), `Product` (fabric catalog with yarn g/m), `Order` (snapshots, statusHistory), `Counter`.
- `users.buyerId`: required for BUYER at account creation; `req.user.buyerId` read from the DB.
- Ownership: buyers read, list and cancel only their company's orders (404 otherwise).
- Field visibility: money for ADMIN + owning BUYER; yarn requirement for internal roles.
- Transitions: `ORDER_CREATED → CANCELLED` (owner/ADMIN), `ORDER_CREATED → REJECTED` (ADMIN).
- Idempotent create/cancel/reject; order numbers from a counter inside the transaction.
- `seed:dev` adds buyer `BUY-DEV` (linked to buyer@) and two products.
- Docs: `docs/features/phase-05-orders.md`, `docs/learning/phase-05-orders.md`, README contract, DATABASE.md.

## Phase 6 — what is done

Built before Phase 4 because reservation starts from `CONFIRMED` (`docs/DATABASE.md` lifecycle;
`instruction.md` §25 lists feasibility before reservation).

- Explainable check (`services/feasibility.service.js`): `MATERIAL` (free yarn of the material/colour =
  stock − reserved − other `CONFIRMED` orders' need), `DEADLINE` (still after today, IST),
  `MACHINE_CAPACITY` reported `NOT_ASSESSED` until machines exist.
- `GET /api/orders/:id/feasibility` (STORE_KEEPER, FLOOR_MANAGER, ADMIN), live, read-only.
- `POST /api/orders/:id/confirm` (ADMIN, Idempotency-Key): re-checks inside the transaction, refuses
  with `409 ORDER_NOT_FEASIBLE`, stores the `feasibility` snapshot + `confirmedBy`, audits `ORDER_CONFIRMED`.
- Per material/colour lock (`locks/yarn-commitment:*`) so concurrent confirmations cannot double-promise yarn.
- `CONFIRMED → CANCELLED` (owning BUYER or ADMIN).
- Frontend: feasibility card and Confirm button on order detail.
- Docs: `docs/features/phase-06-feasibility.md`, `docs/learning/phase-06-feasibility.md`, README contract, DATABASE.md.

## Phase 4 — what is done

- `materialReservations` (per order, per lot): reserved / issued / returned / released counters, guarded.
- `POST /orders/:id/reserve` (FIFO or store keeper's chosen lots; whole requirement or nothing;
  `CONFIRMED → MATERIAL_RESERVED`), `GET /orders/:id/reservations`, `POST /orders/:id/issue`,
  `POST /orders/:id/return`; cancelling a reserved order releases unissued yarn in the same transaction.
- Ledger rows `RESERVATION`, `ISSUE`, `RETURN`, `RESERVATION_RELEASE` carry `orderId`; ledger filter by order.
- Frontend: Reserve yarn modal, yarn panel with issue/return, store and floor dashboard queues.
- Docs: `docs/features/phase-04-reservation.md`, README contract, DATABASE.md.

## Phase 7 — what is done

- `machines` (registry; code/type locked; retire, never delete) and append-only `machineEvents`.
- States per D4 (no IDLE). Maintenance start/end; problems by category and severity; CRITICAL takes a
  machine DOWN and resolving the last critical problem returns it where it was (RUNNING → PAUSED).
- Per-machine lock: concurrent actions on one machine cannot leave it in a wrong state.
- Downtime from critical problems; history with filters; `seed:dev` adds five demo machines.
- Frontend: live Machines list and detail (report/resolve problems, maintenance, admin edit/retire);
  the sample Factory Floor Map moved to `/floor-map` (still labelled preview); floor dashboard KPI.
- Docs: `docs/features/phase-07-machines.md`, README contract, DATABASE.md (D4 confirmed).

## Phase 8 — what is done

- `productionRuns` and `rolls`: plan (machine of the fabric's type, never more than the order), start
  (machine assigned, not down/maintenance, yarn on the floor; order → IN_PRODUCTION), pause/resume with the
  machine, record rolls with traceability, complete (order → PRODUCTION_COMPLETED when fully produced),
  cancel planned runs; machine problems pause the running run; order cancel cancels planned runs.
- Order + machine locks; the concurrent-completion test fails without them.
- Frontend: live Production list and run detail, Plan run, order production panel; the sample production
  board moved to `/production-board` (labelled preview).
- Docs: `docs/features/phase-08-production.md`, README contract, DATABASE.md.

## Next

1. Phase 9 — roll traceability: roll list/detail, roll → lots → order → machine views, labels.
2. Phase 10 — QC on rolls (pass / rework / reject, with signatures), then finished goods (11) and dispatch (12).
3. Machine-capacity check in feasibility needs a decision: working hours per day per machine.

## Open decisions / process issues

- **D6, D7, D8** (`docs/DATABASE.md` §7) still need confirmation (D7 is already built as proposed). D4 confirmed; D3 applied as proposed in Phase 8.
- **Integration:** the team merges `feature/backend` into `main` through PRs (as with PRs #3–#24).
  `develop` is not used in practice and is still at Phase 1.
- **PRs must be opened by hand**: `gh` is not installed.
- Phase numbers here differ from `instruction.md` §32 (e.g. orders are Phase 4 there, 5 here).

## Known issues / limitations

- Audit entries contain cost data: the Phase 13 audit query API must filter `before`/`after` by role.
- Reconciliation loads all lots into memory (fine at factory scale).
- Login rate limits are in memory (per process, reset on restart); `trust proxy` needed behind a proxy.
- Audit events for login and user management are specified but not emitted until Phase 13.
- Existing BUYER accounts without `buyerId` see no orders until linked; there is no admin "link an
  existing user to a company" endpoint yet (`seed:dev` links `buyer@everest.local`).
- Orders cannot progress past `MATERIAL_RESERVED` until Phase 8 (production runs).
- Feasibility does not assess machine capacity yet; the admin dashboard's yarn-demand view counts only
  `ORDER_CREATED` orders, not confirmed ones.
- SIGTERM graceful-shutdown test is skipped on Windows.
- Dev-only `npm audit` advisories in `sprintf-js` (via Jest); runtime dependencies have none.
