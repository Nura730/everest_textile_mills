# Phase 4 — Material reservation (reserve, issue, return, release)

> Built after Phase 6 (feasibility and confirmation): the documented lifecycle is
> `ORDER_CREATED → CONFIRMED → MATERIAL_RESERVED`, so a reservation starts from a confirmed order.

## Users
- **STORE_KEEPER, ADMIN**: reserve yarn for a confirmed order, issue it to production, take back unused yarn.
- **FLOOR_MANAGER**: sees each order's reserved lots and what is on the floor; does not move yarn.
- **BUYER**: sees the order reach "Yarn reserved" in its status; never stock figures.
- **QC_INSPECTOR**: no access.

## Problem
`instruction.md` §2 and §6: the store keeper reserves material for orders and issues it to production;
**available stock ≠ reserved stock**, and reserved yarn must not be consumed by another order.
Before this phase a confirmed order only *promised* yarn (feasibility subtracted it); nothing actually
set it aside.

## Business rules
1. Reservation covers the order's **whole** `requiredYarnGrams` of its material and colour, or nothing.
2. Default: oldest lots first (FIFO). The store keeper may instead choose lots and amounts
   ("Cotton → Navy → select 850 kg"); they must match the order's material and colour and add up
   exactly.
3. Reserving moves grams from available to reserved (`total` unchanged): guarded per lot so a lot can
   never reserve more than it has available, and serialised with confirmations by the shared lock.
4. `CONFIRMED → MATERIAL_RESERVED` on success. Once reserved, the yarn leaves the "promised to confirmed
   orders" figure of feasibility and appears in `reserved`, so feasibility stays correct unchanged.
5. Issue: reserved yarn handed to the floor (`total` and `reserved` both drop), partially or fully, oldest
   reservation first, at most what is still reserved. Order status unchanged (production is Phase 8).
6. Return: unused yarn back into the lots it came from (`total` rises), at most what is on the floor,
   reason required, allowed in any status (including after cancellation).
7. Cancelling a reserved order releases what is still reserved, in the same transaction as the
   cancellation. Issued yarn stays issued until returned.
8. Adjustments still cannot write a lot down below its reserved quantity (existing rule).
9. Every movement: ledger row with `orderId` and `reservationId`, audit entry, idempotency key.
   Reconciliation proves every lot against its ledger after any mix of movements.

## Data
`materialReservations` (new); `yarnLots.reservedGrams`; `inventoryTransactions` (four movement types now
in use); `orders.status`. See `docs/DATABASE.md`.

## API
| Method | Path | Roles |
|---|---|---|
| POST | `/api/orders/:id/reserve` | STORE_KEEPER, ADMIN — Idempotency-Key; `{}` or `{ allocations }` |
| GET | `/api/orders/:id/reservations` | STORE_KEEPER, FLOOR_MANAGER, ADMIN |
| POST | `/api/orders/:id/issue` | STORE_KEEPER, ADMIN — Idempotency-Key; `{ quantityKg }` |
| POST | `/api/orders/:id/return` | STORE_KEEPER, ADMIN — Idempotency-Key; `{ quantityKg, reason }` |
| GET | `/api/yarn-lots/:id/transactions?orderId=` | ledger filtered to one order |

## UI
Order detail: **Reserve yarn** (confirmed orders; FIFO preview or choose lots with a live total),
**Yarn for this order** panel (per lot: reserved, still reserved, issued, on the floor, released) with
**Issue to production** / **Return to store**. Store dashboard: "Waiting for yarn reservation". Floor
dashboard: reserved orders join the work queue. Lot ledger: each movement links to its order.

## Edge cases
Not enough yarn in total or in a chosen lot (409, nothing stored); wrong-colour, duplicate or unknown
lot; amounts not adding up; reserving twice or for a non-confirmed order; two orders racing for the same
kilograms (one wins); issue above what is reserved; return above what is on the floor; cancel after a
partial issue (only the rest is released); return after cancellation; retries with the same key.

## Audit events
`MATERIAL_RESERVED` (mode FIFO/MANUAL, lots), `MATERIAL_ISSUED`, `MATERIAL_RETURNED`, `MATERIAL_RELEASED`.

## Tests
`tests/unit/reservation.test.js` (FIFO planner, counters, statuses),
`tests/integration/reservation.test.js` (every rule above, reconciliation after each flow), RBAC matrix
rows for the four new routes.
