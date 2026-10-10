# Phase 6 — Order feasibility and confirmation (material + deadline)

> Built before Phase 4 (material reservation): the order lifecycle in `docs/DATABASE.md` is
> `ORDER_CREATED → CONFIRMED → MATERIAL_RESERVED`, and `instruction.md` §25 lists feasibility before
> reservation, so a reservation needs a confirmed order to start from.
> Scope of this step: the **material** and **deadline** checks. Machine capacity needs machines,
> production rates and workload (Phases 7–8) and is reported as `NOT_ASSESSED` until then.

## Users
- **ADMIN**: sees the live check on an order and confirms it.
- **STORE_KEEPER, FLOOR_MANAGER**: see the live check (they plan yarn and production around it).
- **BUYER**: sees that the order is `CONFIRMED` in its status and history, never the stock behind it.
- **QC_INSPECTOR**: no access to the check (stock is not their concern).

## Problem
Orders were accepted on trust: nobody could say whether the factory had the yarn or the time.
`instruction.md` §5 asks for a check that says "HIGH RISK / NOT FEASIBLE" **and explains why**, with
no black-box decision.

## Business rules
1. The check is a list of named checks, each `PASS`, `FAIL` or `NOT_ASSESSED`, each with a sentence
   saying what was compared. `NOT_FEASIBLE` if any check fails, otherwise `FEASIBLE`.
2. **Material**: free yarn of the order's material and colour must cover `requiredYarnGrams`.
   `free = (Σ totalGrams − Σ reservedGrams over all lots) − Σ requiredYarnGrams of other CONFIRMED orders`.
   Confirmed orders hold no reservation until Phase 4, so without the second term the same kilograms
   could be promised to two orders. Exactly enough passes (no hidden margin).
3. **Deadline**: `requiredBy` must still be after today in India. An order placed for next week and
   left unconfirmed until after its date fails.
4. **Machine capacity**: always `NOT_ASSESSED` for now; it never decides the verdict.
5. Confirmation (`ORDER_CREATED → CONFIRMED`) is ADMIN-only, takes no input, re-runs the check inside
   the transaction and is refused with `409 ORDER_NOT_FEASIBLE` (+ the full result) if it fails. There
   is no override.
6. A passing check is stored on the order as `feasibility` with `confirmedBy`: the evidence for the
   decision, kept even when stock changes later.
7. Two confirmations for the same material and colour serialise on a shared lock document
   (`locks/yarn-commitment:<material>:<colour>`), so they cannot both pass against the same free yarn.
8. A confirmed order can be cancelled (owning BUYER or ADMIN), which frees its yarn for other orders.
   It can no longer be rejected.
9. Confirm requires an `Idempotency-Key`; the status change, snapshot, audit entry and idempotency
   record commit together. A refused confirmation stores nothing, so the same key can succeed later.

## Data
`orders.feasibility`, `orders.confirmedBy`; reads `yarnLots` balances and other orders; writes
`locks`. See `docs/DATABASE.md`.

## API
| Method | Path | Roles |
|---|---|---|
| GET | `/api/orders/:id/feasibility` | STORE_KEEPER, FLOOR_MANAGER, ADMIN — read-only, live |
| POST | `/api/orders/:id/confirm` | ADMIN — Idempotency-Key, empty body |

## UI
Order detail: a **Feasibility** card (live check: verdict, yarn needed / free / promised / days left,
each check's sentence) for planning roles while the order awaits a decision; a **Confirm** button
for the admin, disabled while the live check fails. After confirmation the card shows the recorded
snapshot. The buyer sees only the status.

## Edge cases
Exactly enough yarn (passes); one gram short (fails, shortfall shown); reserved yarn and other
colours/materials not counted; promises exceeding stock (free shown as 0, not negative); deadline today
or past; confirm twice (409 transition); confirm a cancelled/rejected order (409); stock arrives after a
refusal (same key succeeds); concurrent confirmations for the same yarn (exactly one wins); confirmed
order cancelled (yarn freed); body with any field (400); no key (400); unknown order (404).

## Audit events
`ORDER_CONFIRMED` (`before.status`, `after.status`, `after.feasibility`).

## Tests
Unit: `tests/unit/feasibility.test.js` (every rule above), transition table. Integration:
`tests/integration/orders.confirm.test.js` (live check, confirm, refusal, idempotency, ownership of
fields, committed yarn, concurrency), RBAC matrix rows for both routes.

## Not done here
Machine capacity and estimated completion (Phase 7–8); reservation on confirmation (Phase 4); the
admin dashboard's "yarn demand vs stock" still counts only `ORDER_CREATED` orders.
