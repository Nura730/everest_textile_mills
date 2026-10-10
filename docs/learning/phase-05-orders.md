# Learning digest — Phase 5: Buyers, fabric catalog and orders

## The business rules in one breath

A buyer is a company, and its people log in as BUYER accounts linked to it. The admin keeps a
catalog of fabrics, each with how much yarn one metre consumes. A buyer orders one fabric, a length
and a date; the server — never the client — numbers the order, copies the product and price onto
it, and works out the yarn needed and the order value with integer maths. A buyer sees and cancels
only their own company's orders; the admin can reject. Every other status change waits for its phase.

## Data flow in plain English

**Placing an order** (`POST /api/orders`, buyer)
1. `authenticate` loads the user **and their `buyerId`** from the database.
2. `authorize(BUYER, ADMIN)` → `requireIdempotencyKey` → validation with the **buyer** schema
   (strict: no `buyerId`, `status`, prices…), chosen because the caller is a buyer.
3. The service takes the company from the account (403 if the account is not linked).
4. `executeIdempotent` opens one transaction:
   - load buyer (active?) and product (exists? active?);
   - `quantityCm = metres × 100`; `requiredYarnGrams = ⌈cm × g/m ÷ 100⌉`; `value = round(cm × price ÷ 100)`;
   - `seq = counters.$inc('order:2026')` → `ORD-2026-0001`;
   - insert the order with product and buyer **snapshots** and the first history entry;
   - write `ORDER_CREATED` to the audit log; store the response on the idempotency key; **commit**.
5. `toPublicOrder` shapes the response for the viewer (buyer: price yes, yarn no).

**Reading an order** (`GET /api/orders/:id`)
Load it; if the caller is a BUYER and the order's `buyerId` is not theirs → **404**, exactly like a
missing order. Then shape the fields for the viewer's role.

**Cancelling** (`POST /api/orders/:id/cancel`)
In one transaction: load, check ownership, check the transition table
(`ORDER_CREATED → CANCELLED`), then a **guarded** update `{ _id, status: 'ORDER_CREATED' }` that also
appends the history entry; audit `ORDER_CANCELLED`. A second cancel finds `CANCELLED`, which has no
allowed transitions → `409 INVALID_STATE_TRANSITION` with `{ from, to, allowed }`.

## Key design decisions and why

| Decision | Why | Trade-off |
|---|---|---|
| Buyer = company, users link to it | Several people order for one company; ownership is per company | One more collection and a link on users |
| `buyerId` enforced at account creation, not in the schema | Existing BUYER accounts stay valid and simply fail closed | The rule lives in the service/validator, so it must be tested there (it is) |
| Two strict create schemas, picked by role | A buyer *cannot* name a company — it's not "ignored", it's a 400 | The route picks the schema at request time |
| Snapshot product and buyer on the order | A price change next month must not rewrite last month's orders | Some duplicated data (small, immutable) |
| Integer maths, yarn rounded **up** | Under-planning yarn stops production; one extra gram costs nothing | — |
| Deadline is a calendar date in India time | "Deliver by 20 Oct" is a day, not an instant; the factory works on IST | Stored as UTC midnight, returned as `YYYY-MM-DD` |
| Order number from a counter **inside** the transaction | Failed orders don't burn numbers; concurrent orders get distinct numbers | A write on the counter document per order (fine at this scale) |
| Unique index on `orderNumber` as the last line | If the counter ever goes backwards (restore), duplicates are refused, not created | — |
| 404 (not 403) for another company's order | 403 would confirm the order exists; 404 reveals nothing | — |
| Transition table + guarded update | The table says *what* is allowed; the guarded update makes it safe under concurrency | — |
| Only cancel/reject now | Confirmation needs feasibility (Phase 6); building it early would be a fake | Orders cannot progress until Phase 6 |
| Reference that doesn't exist → 400 | The form is wrong (pick a real product), not the factory state | Frontend highlights `productId`/`buyerId` |

## Things worth saying to a judge

- **Proved the ownership tests can fail:** with the ownership check disabled, exactly the two
  "another company's order" tests fail.
- **Failure mid-transaction:** making the audit write fail leaves no order and does not consume an
  order number; retrying with the same key then gets `ORD-…-0001`.
- **Concurrency:** four simultaneous orders get four distinct numbers; a concurrent cancel and reject
  on the same order — exactly one wins (5/5 runs).
- **Real bug found by tests:** Mongoose mutates the update object it is given; the frozen seed
  constants made it throw. Fixed by passing a copy.

## Judge-style questions (try first, then read the model answer)

**1. "Buyer A changes the order id in the URL to Buyer B's order. What happens?"**
> `GET /api/orders/:id` loads the order and compares its `buyerId` with the caller's `buyerId`, which
> `authenticate` read from the database (not from the token or the request). They differ, so we
> answer `404 Order not found` — the same response as a non-existent id — so Buyer A can't even
> learn that the order exists. Cancel uses the same check inside its transaction. That's object-level
> authorization (OWASP API #1); role checks alone can't do it because both users are BUYERs. A test
> fails if the check is removed.

**2. "How do you stop a buyer from creating an order that is already CONFIRMED, or at a lower price?"**
> The request body is validated with a strict schema chosen by role. For a buyer it contains only
> `productId`, `quantityMetres`, `requiredBy` and `buyerNotes`; any other key — `status`, `orderNumber`,
> `pricePerMetrePaise`, even `buyerId` — is rejected with 400, not silently dropped. The server sets
> the status to `ORDER_CREATED`, takes the price from the catalog, and the company from the account.

**3. "Two people create an order at the same second. Can they get the same order number?"**
> No. The number comes from `$inc` on a counter document inside each order's transaction. Two
> transactions writing the same counter document conflict; MongoDB aborts one and it retries with
> the next value. A test fires four creates at once and gets 0001–0004. If the counter were ever
> rolled back (say, a restore), the unique index on `orderNumber` refuses the duplicate with
> `409 DUPLICATE_RESOURCE` and nothing is written — also tested.

**4. "Why copy the price and yarn figure onto the order instead of referencing the product?"**
> Because an order is a commitment at a point in time. If the admin raises the Navy Cotton price
> next month, last month's order must keep its agreed price, and production planning must keep the
> yarn figure it was promised. The order keeps `productId` for traceability plus an immutable
> snapshot of what was agreed; a test changes the catalog after ordering and checks the order is
> unchanged.

**5. "The admin cancels and rejects the same order at the same moment. What's in the database?"**
> Exactly one of them. Each runs in a transaction: read the order, check the transition table, then
> update with the filter `{ _id, status: 'ORDER_CREATED' }`. The second transaction conflicts on the
> same document, is retried, now reads `CANCELLED` (or `REJECTED`), finds no allowed transition and
> returns `409 INVALID_STATE_TRANSITION`. The order ends with two history entries (created + one
> change) and one audit entry. The test asserts `[200, 409]` and runs stably.
