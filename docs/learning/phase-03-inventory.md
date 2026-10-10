# Learning digest — Phase 3: Yarn inventory

## The business rules in one breath

Every delivery of yarn becomes a **lot**. A lot knows how much is physically in the store (total)
and how much is already promised to orders (reserved); what anyone else may still take
(available) is always computed as total − reserved. Every change to those numbers leaves a ledger
row, an audit entry, and an idempotency record, all committed together or not at all. Only the
owner can correct stock, never below what is promised. The owner can prove at any time that the
numbers match the ledger.

## Data flow in plain English

**Receiving yarn** (`POST /api/yarn-lots`, store keeper)
1. `authenticate` → who is this? `authorize(STORE_KEEPER, ADMIN)` → may they receive?
2. `requireIdempotencyKey` → the request must carry a key (a UUID made by the frontend).
3. `validate` → kg > 0 with ≤ 3 decimals, cost in integer paise, colour → "Navy Blue", lot number
   → "GRN-2026-0104", no unknown fields, not dated in the future.
4. `executeIdempotent` opens **one transaction**:
   - Has this user already used this key? → return the stored response (replay).
   - Claim the key (placeholder record) — a concurrent duplicate collides here.
   - Create the lot with `totalGrams = kg × 1000`.
   - Append a `RECEIPT` ledger row (+grams).
   - Append a `MATERIAL_RECEIVED` audit entry (who, what, request id, key).
   - Save the response on the key record. **Commit.**
5. Respond `201` with the lot (cost included because the caller is a store keeper).

**Adjusting stock** (`POST /api/yarn-lots/:id/adjustments`, admin)
Same shape, but the balance change is one guarded atomic update:
"add Δ to total **only if** total + Δ ≥ reserved". If it matches nothing → `409 INSUFFICIENT_STOCK`,
the transaction aborts, nothing is written.

**Proving the numbers** (`GET /api/inventory/reconciliation`, admin)
Sum every lot's ledger rows; compare with the balances stored on the lot; check
0 ≤ reserved ≤ total; list any lot that disagrees and any ledger row without a lot.

## Key design decisions and why

| Decision | Why | Trade-off |
|---|---|---|
| Integer grams, integer paise | Floats drift when summed (`0.1 × 10 ≠ 1`); a ledger must reconcile exactly | Conversion at the API edge; kg limited to 3 decimals |
| Balances on the lot **and** a ledger | Fast reads from the lot; the ledger is the proof and the history | Two writes per change — always in one transaction |
| Available is computed, never stored | A stored "available" can disagree with total − reserved; a computed one can't | — |
| Guarded atomic update instead of read-check-write | The check and the write are one operation, so concurrent requests can't both pass a check only one should pass | The guard must be expressed as a MongoDB filter (`$expr`) |
| One transaction for lot + ledger + audit + idempotency | No change without its history; no history without its change; no half-used keys | Requires a replica set (Atlas has one) |
| Idempotency key per **(actor, key)** | One user's key can never replay another user's response | Keys only unique per user |
| Key claimed **first** in the transaction | Concurrent duplicates collide immediately, before any business work | One extra write per call |
| Failed attempts store nothing | A retry after "insufficient stock" is re-evaluated against current stock | A client can't "replay" a failure |
| Append-only plugin for ledger and audit | History is evidence; corrections are new rows | Tests must clean up underneath the model |
| Adjustments ADMIN-only with a reason | Write-offs can hide theft; the owner should authorise them | Store keeper must ask the admin |
| Cost hidden from the floor manager | Yarn cost is internal financial data; the floor needs quantities only | Decided in the service, so every endpoint applies it the same way |
| Repositories start here | Inventory queries and guarded updates deserve their own layer; services read like rules | One more file per entity |

## Things worth saying to a judge

- **We proved our tests can fail.** The atomicity test makes the audit write throw midway: no lot, no
  ledger row, no key — and the same key then succeeds. The concurrency tests run repeatedly (5/5).
- **Reconciliation catches tampering**: edit `totalGrams` directly in MongoDB and the report names the
  lot and shows stored vs ledger.
- **Known gap:** audit entries contain cost; the Phase 13 audit *query* must filter it by role.

## Judge-style questions (try first, then read the model answer)

**1. "Two store keepers both see 400 kg available and both write off 300 kg at the same moment. What happens?"**
> Each write-off is a single atomic MongoDB update that only matches if `total − 300 kg ≥ reserved`.
> MongoDB applies them one after the other on that document (inside transactions, the second gets a
> write conflict and is retried). The first matches and applies; the second re-evaluates against the
> new total, no longer matches, and returns `409 INSUFFICIENT_STOCK`. The test fires both at once
> and asserts exactly one 201 and one 409, and that only one ledger row exists.

**2. "Why store grams and paise as integers? JavaScript numbers can hold 1250.5."**
> They can hold it, but sums of decimal fractions are not exact in binary floating point —
> `0.1 + 0.2 = 0.30000000000000004`, and ten receipts of 0.1 kg don't add up to 1 kg. Our
> reconciliation compares the lot balance with the sum of thousands of ledger rows; with floats
> they could disagree by a rounding error and we couldn't tell bugs from noise. Integers add exactly.
> The API still speaks kg (≤ 3 decimals) so the frontend is natural; conversion happens once, at
> the edge.

**3. "The tablet sends 'receive 1,250 kg', the Wi-Fi drops, and it retries. How many lots do you get?"**
> One. The tablet sends the same `Idempotency-Key` on the retry. If the first attempt committed, the
> key's record exists and we replay the stored response with `Idempotent-Replayed: true`. If it
> didn't commit, nothing was stored (the record is in the same transaction), so the retry simply
> runs. If both arrive at the same time, they collide on the unique `(actor, key)` index and the
> loser replays the winner's response. Reusing the key for a *different* body is a client bug and
> gets `409 IDEMPOTENCY_KEY_REUSED`.

**4. "How do you know your stock numbers are correct right now?"**
> Two independent records: the running balances on each lot, and the append-only ledger. Every
> change writes both in one transaction. `GET /api/inventory/reconciliation` sums the ledger per lot
> and compares; it also checks 0 ≤ reserved ≤ total. If someone changes a balance outside the
> service — a bug or a manual database edit — the report names the lot and shows both numbers. The
> ledger itself can't be edited through the application (append-only plugin), and in production
> the database user would have insert/find rights only on it.

**5. "Why does the floor manager see stock but not cost? Isn't hiding a field in the UI enough?"**
> Hiding in the UI is cosmetic — the floor manager could read the JSON in the browser's dev tools.
> The rule "cost is internal financial data, visible to the store and the owner" lives in the
> service (`canSeeCost`), and the public lot shape only includes `costPerKgPaise` when it's true,
> so the field never leaves the server. That's field-level authorization, on top of the
> route-level `authorize()`. The same principle will apply to the audit trail, where cost appears
> inside audit entries.
