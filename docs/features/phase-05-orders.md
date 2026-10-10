# Phase 5 — Buyers, fabric catalog and orders

> Built before Phase 4 (material reservation) by decision D5: a reservation is always for an order.
> Decisions D1 (single-product orders) and D2 (fabric catalog with yarn consumption) confirmed.

## Users
- **ADMIN**: manages buyer companies and the fabric catalog; creates orders on a buyer's behalf;
  cancels or rejects orders.
- **BUYER**: browses the catalog, places orders for their own company, sees and cancels only their
  own orders.
- **STORE_KEEPER, FLOOR_MANAGER, QC_INSPECTOR**: read orders (they plan material, production and
  inspection around them) without commercial values.

## Problem
Orders arrive by phone and paper; nobody can see which buyer wants what, by when, or how much yarn
it needs. Feasibility (Phase 6), reservation (Phase 4), production and dispatch all hang off an
order, so it must exist as a well-defined record first.

## Business rules
1. A **buyer** is a company; several BUYER user accounts can belong to one company (`user.buyerId`).
   `POST /api/users` requires `buyerId` for role BUYER and rejects it for other roles.
2. A **product** is a catalog fabric: material, colour, weave, width, GSM, and
   `yarnGramsPerMetre` — yarn consumed per metre **including** standard process waste. It can never be
   less than the fabric's own weight per metre: `yarnGramsPerMetre ≥ ⌊gsm × widthCm / 100⌋`.
3. One order = one product (D1). Quantity in metres (≤ 2 decimals, stored as integer cm).
4. On creation the order **snapshots** the product (code, name, material, colour, yarn g/m, price)
   and buyer (code, name): later catalog edits never change an existing order.
5. Derived with integer maths only:
   `requiredYarnGrams = ceil(quantityCm × yarnGramsPerMetre / 100)` (round up: never under-plan yarn);
   `orderValuePaise = round(quantityCm × pricePerMetrePaise / 100)`.
6. `requiredBy` is a calendar date, strictly after today in India (IST) and at most 2 years ahead.
7. Order numbers are `ORD-<year>-<seq>` from a counter incremented **inside** the creation
   transaction, with a unique index as the final guard.
8. A BUYER's company comes from their account, never from the body. An ADMIN must name `buyerId`.
   An unlinked BUYER account fails closed (403, sees no orders).
9. **Ownership:** a BUYER can read, list and cancel only their company's orders; anything else is
   404 (no ID probing).
10. **Field visibility:** price and order value — ADMIN and the owning BUYER only. Yarn requirement —
    internal roles only.
11. Lifecycle implemented now: `ORDER_CREATED → CANCELLED` (owning BUYER or ADMIN, reason required),
    `ORDER_CREATED → REJECTED` (ADMIN, reason required). Every other transition is
    `409 INVALID_STATE_TRANSITION`. `CONFIRMED` arrives with feasibility (Phase 6).
12. Inactive buyer or product cannot receive new orders (409).
13. Create, cancel and reject require an `Idempotency-Key`; each writes the change, an audit entry and
    the idempotency record in one transaction.

## Data
`buyers`, `products`, `orders` (with `statusHistory`), `counters`; `users.buyerId`. See `docs/DATABASE.md`.

## API
| Method | Path | Roles |
|---|---|---|
| POST | `/api/buyers` | ADMIN |
| GET | `/api/buyers`, `/api/buyers/:id` | ADMIN |
| POST | `/api/products` | ADMIN |
| GET | `/api/products`, `/api/products/:id` | all roles (non-admins: active only; buyers: no yarn spec) |
| POST | `/api/orders` | BUYER (own company), ADMIN (names buyer) — Idempotency-Key |
| GET | `/api/orders`, `/api/orders/:id` | all roles (BUYER: own only) |
| POST | `/api/orders/:id/cancel` | BUYER (own), ADMIN — Idempotency-Key |
| POST | `/api/orders/:id/reject` | ADMIN — Idempotency-Key |

## Edge cases
Zero/negative/over-precise/over-large quantity; deadline today, past or > 2 years; malformed or
non-existent buyer/product id (400 with field); inactive buyer/product (409); protected fields in
body (`status`, `orderNumber`, prices, `buyerId` from a buyer) → 400; buyer A reading, listing or
cancelling buyer B's order (404); unlinked buyer account (403); cancel after cancel, reject after
cancel, concurrent cancel + reject (exactly one wins); duplicate order number (409, nothing written);
failure mid-transaction (nothing written, number not consumed); double-submitted create (one order).

## Audit events
`BUYER_CREATED`, `PRODUCT_CREATED`, `ORDER_CREATED`, `ORDER_CANCELLED`, `ORDER_REJECTED`.

## Tests
Unit: order maths, deadline rules, transition table. Integration: buyers, products, user–buyer link,
order create (validation, idempotency, numbering, atomicity), queries and ownership, transitions and
concurrency, seed script, RBAC matrix.
