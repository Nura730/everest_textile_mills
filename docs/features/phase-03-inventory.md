# Phase 3 — Yarn inventory

## Users
- **STORE_KEEPER**: receives yarn, browses stock.
- **ADMIN**: everything the store keeper does, plus stock adjustments and the reconciliation report.
- **FLOOR_MANAGER**: read-only view of stock (to see what material exists), **without cost**.
- QC_INSPECTOR, BUYER: no access.

## Problem
Raw-material stock is tracked manually, so nobody trusts the numbers: how much Navy Cotton is in
the store, how much is already promised, and what it cost. Every later phase (reservation,
feasibility, costing) builds on these numbers, so they must be provably correct.

## Business rules
1. Every receipt creates a **yarn lot** (supplier batch). Lot numbers are unique.
2. Quantities are stored as **integer grams**; the API speaks kg with at most 3 decimals.
   Cost is stored and exchanged as **integer paise per kg**.
3. A lot holds `totalGrams` and `reservedGrams`; **available = total − reserved** is always computed,
   never stored. Invariant: `0 ≤ reserved ≤ total`.
4. Every stock change appends an **inventory transaction** (ledger row). For every lot,
   Σ ledger deltas must equal the lot's balances — the reconciliation report proves it.
5. Each stock change, its ledger row, its audit record and its idempotency record are written in
   **one MongoDB transaction**: all or nothing.
6. Every mutating call requires an **`Idempotency-Key`** header. Repeating a successful call with the
   same key replays the original response and changes nothing; reusing a key for a different
   request is `409 IDEMPOTENCY_KEY_REUSED`.
7. **Adjustments** (physical count corrections, damage) are ADMIN only, need a reason, and can never
   bring a lot below its reserved quantity (or below zero).
8. Cost is visible to STORE_KEEPER and ADMIN only.

## Data
`yarnLots`, `inventoryTransactions` (RECEIPT, ADJUSTMENT in this phase), `idempotencyRecords`,
`auditLogs` (model and recorder introduced now; query API in Phase 13). See `docs/DATABASE.md`.

## API
| Method | Path | Roles | Idempotency-Key |
|---|---|---|---|
| POST | `/api/yarn-lots` (receive a lot) | STORE_KEEPER, ADMIN | required |
| GET | `/api/yarn-lots` | STORE_KEEPER, FLOOR_MANAGER, ADMIN | — |
| GET | `/api/yarn-lots/:id` | STORE_KEEPER, FLOOR_MANAGER, ADMIN | — |
| GET | `/api/yarn-lots/:id/transactions` | STORE_KEEPER, FLOOR_MANAGER, ADMIN | — |
| POST | `/api/yarn-lots/:id/adjustments` | ADMIN | required |
| GET | `/api/inventory/yarn-summary` | STORE_KEEPER, FLOOR_MANAGER, ADMIN | — |
| GET | `/api/inventory/reconciliation` | ADMIN | — |

## Edge cases
- Quantity 0, negative, > 100,000 kg, or more than 3 decimals → 400.
- Receipt dated in the future → 400.
- Duplicate lot number (different key) → 409 DUPLICATE_RESOURCE.
- Same key, same body, twice (or concurrently) → one lot, one ledger row, one audit record; the
  second call replays the first response with `Idempotent-Replayed: true`.
- Same key, different body → 409 IDEMPOTENCY_KEY_REUSED.
- Missing/malformed key → 400.
- Failure in the middle of the transaction (e.g. audit write fails) → nothing is persisted, and the
  key is not consumed (a retry can succeed).
- Adjustment that would go below reserved or below zero → 409 INSUFFICIENT_STOCK, including two
  concurrent negative adjustments that are each fine alone.
- Colour spelt differently (`navy blue`, ` Navy  Blue `) → one catalog entry (`Navy Blue`).

## Audit events
`MATERIAL_RECEIVED`, `STOCK_ADJUSTED`.

## Tests
Unit: unit conversion, decimals, colour normalisation, request hashing.
Integration: audit log append-only; idempotency service (replay, mismatch, concurrency, failure,
per-actor scope); receive (happy path, validation, RBAC, idempotency, atomicity); catalog, lot,
ledger and summary queries (aggregates, cost visibility); adjustments (bounds, concurrency);
reconciliation (clean and tampered); RBAC matrix rows.
