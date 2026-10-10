# Learning digest — Phase 6: Order feasibility and confirmation

## The business rules in one breath

Before the factory commits to an order, the server checks two things and says why: is there enough
**free** yarn of that material and colour (stock minus reservations minus what other confirmed orders
need), and is the deadline still ahead? If both pass, the admin can confirm, and the result is stored
on the order as evidence. If not, confirmation is refused with the reasons. Machine capacity is listed
as "not assessed" until machines exist.

## Data flow in plain English

**Looking at the check** (`GET /api/orders/:id/feasibility`, planning roles)
1. Load the order (404 if missing).
2. Sum `totalGrams` and `reservedGrams` over every yarn lot of the order's material and colour.
3. Sum `requiredYarnGrams` of every **other** order in `CONFIRMED` for that material and colour.
4. `evaluateFeasibility()` (pure function, no database) turns those numbers into checks and a verdict.
5. `toPublicFeasibility()` converts grams to kg for the response. Nothing is written.

**Confirming** (`POST /api/orders/:id/confirm`, ADMIN)
1. `authorize(ADMIN)` → `requireIdempotencyKey` → strict empty body.
2. `executeIdempotent` opens one transaction:
   - load the order; is `ORDER_CREATED → CONFIRMED` allowed? (409 otherwise);
   - **claim the lock** `locks/yarn-commitment:COTTON:Navy` (an `$inc` on a shared document);
   - run steps 2–4 above with the transaction's session;
   - failing check → throw `ORDER_NOT_FEASIBLE` (everything rolls back, the key is not used up);
   - guarded update `{ _id, status: 'ORDER_CREATED' }` → `CONFIRMED`, plus `feasibility` and
     `confirmedBy`, plus a history entry;
   - `ORDER_CONFIRMED` audit entry; store the response on the key; **commit**.

## The one tricky idea: write skew

Two admins confirm order A and order B (850 kg each) at the same moment, with 1,000 kg free. Each
transaction reads "0 kg promised to others" and passes, then each writes **its own** order. MongoDB's
snapshot isolation only aborts transactions that write the **same** document, so both would commit and
1,700 kg would be promised against 1,000 kg.

The fix is to make them write the same document: both `$inc` the lock for `COTTON:Navy`. The second
one hits a write conflict, `withTransaction` retries it from the start, and the retry reads A as
`CONFIRMED` (850 kg promised), so B fails the check. Orders for other yarns use other lock documents
and never wait for each other. The test "lets exactly one of two concurrent confirmations for the same
yarn win" fails if the lock line is removed.

## Why the check is a list of sentences

`instruction.md` §5 forbids a black-box verdict. Every check carries the numbers it used in its
message ("Short by 250 kg: needs 850 kg … only 600 kg is free (…)"), and the raw `inputs` are returned
too, so a judge, the admin and the floor manager can all verify it by hand.

## Why "promised to other confirmed orders" exists at all

A confirmed order does not yet hold a reservation (that is Phase 4). Until then, its yarn need is the
only record that those kilograms are spoken for. When Phase 4 reserves yarn, the order moves to
`MATERIAL_RESERVED`, its need leaves the "promised" sum and appears in `reservedGrams` instead, so the
formula stays correct without changes.

## Where to look
- Rules: `backend/src/services/feasibility.service.js`
- Confirm + lock: `backend/src/services/order.service.js` (`confirmOrder`, `claimYarnCommitmentLock`)
- Sums: `sumStockForMaterialColour` (yarn lots), `sumOrderYarnGrams` (orders)
- UI: `frontend/src/pages/OrderDetail.jsx` (`FeasibilityResult`)
