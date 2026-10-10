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
| — | Domain model (`docs/DATABASE.md`) | ✅ Done (D1–D8 await confirmation) | `feature/backend` | via `feature/backend` | — |
| 3 | Yarn inventory | ✅ Done, on `feature/backend` | `feature/backend` | via `feature/backend` | 439 |
| 4 | Material reservation | ⏸ Waiting on decision D5 (phase order) | | | |
| 5 | Orders (+ ownership checks) | Not started | | | |
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

## Next

Blocked on the owner's answers to D1–D8 in `docs/DATABASE.md` §7, especially **D5**: build orders
(Phase 5) before reservation (Phase 4), because a reservation is always for an order.

## Open decisions / process issues

- **D1–D8** (`docs/DATABASE.md` §7) need confirmation before Phase 4/5.
- **Integration:** the team merges `feature/backend` into `main` through PRs (as with PRs #3–#24).
  `develop` is not used in practice and is still at Phase 1.
- **PRs must be opened by hand**: `gh` is not installed.
- `instruction.md` has an uncommitted local edit by the owner; never included in backend commits.

## Known issues / limitations

- Audit entries contain cost data: the Phase 13 audit query API must filter `before`/`after` by role.
- Reconciliation loads all lots into memory (fine at factory scale).
- Login rate limits are in memory (per process, reset on restart); `trust proxy` needed behind a proxy.
- Audit events for login and user management are specified but not emitted until Phase 13.
- SIGTERM graceful-shutdown test is skipped on Windows.
- Dev-only `npm audit` advisories in `sprintf-js` (via Jest); runtime dependencies have none.
