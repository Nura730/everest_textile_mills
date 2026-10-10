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
| 5 | Buyers, catalog, orders (+ ownership) — built before 4 (D5) | 🟡 Implemented, **uncommitted** (awaiting owner review) | `feature/backend` | — | 621 |
| 4 | Material reservation | ⏳ Next | | | |
| 6 | Feasibility | Not started | | | |
| 7 | Machines | Not started | | | |
| 8 | Production runs | Not started | | | |
| 9 | Roll traceability | Not started | | | |
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

## Phase 5 — what is done (uncommitted)

- `Buyer` (company), `Product` (fabric catalog with yarn g/m), `Order` (snapshots, statusHistory), `Counter`.
- `users.buyerId`: required for BUYER at account creation; `req.user.buyerId` read from the DB.
- Ownership: buyers read, list and cancel only their company's orders (404 otherwise).
- Field visibility: money for ADMIN + owning BUYER; yarn requirement for internal roles.
- Transitions: `ORDER_CREATED → CANCELLED` (owner/ADMIN), `ORDER_CREATED → REJECTED` (ADMIN).
- Idempotent create/cancel/reject; order numbers from a counter inside the transaction.
- `seed:dev` adds buyer `BUY-DEV` (linked to buyer@) and two products.
- Docs: `docs/features/phase-05-orders.md`, `docs/learning/phase-05-orders.md`, README contract, DATABASE.md.

## Next

1. Owner reviews and commits Phase 5.
2. Phase 4 — material reservation for orders (reserve, release, issue, return) on the existing ledger.
3. Phase 6 — feasibility and `ORDER_CREATED → CONFIRMED`.

## Open decisions / process issues

- **D3, D4, D6, D7, D8** (`docs/DATABASE.md` §7) still need confirmation (D7 is already built as proposed).
- **Integration:** the team merges `feature/backend` into `main` through PRs (as with PRs #3–#24).
  `develop` is not used in practice and is still at Phase 1.
- **PRs must be opened by hand**: `gh` is not installed.
- `instruction.md` has an uncommitted local edit by the owner; never included in backend commits.

## Known issues / limitations

- Audit entries contain cost data: the Phase 13 audit query API must filter `before`/`after` by role.
- Reconciliation loads all lots into memory (fine at factory scale).
- Login rate limits are in memory (per process, reset on restart); `trust proxy` needed behind a proxy.
- Audit events for login and user management are specified but not emitted until Phase 13.
- Existing BUYER accounts without `buyerId` see no orders until linked; there is no admin "link an
  existing user to a company" endpoint yet (`seed:dev` links `buyer@everest.local`).
- Orders cannot progress past `ORDER_CREATED` until Phase 6 (confirmation after feasibility).
- SIGTERM graceful-shutdown test is skipped on Windows.
- Dev-only `npm audit` advisories in `sprintf-js` (via Jest); runtime dependencies have none.
