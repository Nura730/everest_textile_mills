# Everest domain model

MongoDB (Mongoose), one database, a modular monolith. This document is the reference for every
collection, how they relate, which states they move through, and how stock, idempotency and
traceability stay correct. Phases implement it incrementally; fields marked *(Phase N)* do not exist
before that phase.

## 1. Conventions

| Topic | Rule | Why |
|---|---|---|
| **Quantities** | Stored as **integers in the smallest unit**: yarn in **grams**, fabric length in **centimetres**, time in **minutes**/Dates. The API speaks kg and metres (up to 3 / 2 decimals) and converts at the edge | Same reason as money: `0.1 + 0.2 !== 0.3`. A ledger that sums floats drifts; integers reconcile exactly |
| **Money** | Integer **paise** everywhere, API included (`…Paise` fields) | No float rounding in costing or invoices |
| **Dates** | UTC `Date`; the frontend formats for display | |
| **Ids** | MongoDB `ObjectId`; humans see business numbers (`ORD-2026-0104`, `R-0104-007`) generated from `counters` inside the same transaction | Readable on the floor, unique, gap-tolerant |
| **State** | Every lifecycle field is an enum with an explicit allowed-transition table in its service. The frontend is never trusted | Invalid transitions return `409 INVALID_STATE_TRANSITION` |
| **History** | Ledgers, events, inspections and audit logs are **append-only**. Corrections are new records that reference the original | Nothing is silently overwritten |
| **Deletion** | Business records are never deleted; they are cancelled/deactivated | Traceability and audit |
| **Concurrency** | Single-document invariants use **conditional atomic updates** (`updateOne({ _id, <guard> }, { $inc })`). Multi-document changes use a **transaction**. Mutable aggregates carry a `version` for offline conflict detection | |
| **Public shape** | Models are never returned directly; each has a `toPublic…()` allowlist | New fields stay private by default |

## 2. Collections at a glance

```
users ─┬─ buyerId ──────────────▶ buyers
       │
products (fabric catalog)
       ▲
orders ─── buyerId, productId ──▶ buyers, products
  │
  ├──▶ materialReservations ──▶ yarnLots ◀── inventoryTransactions (ledger)
  │                                  ▲
  ├──▶ productionRuns ── machineId ─▶ machines ◀── machineEvents
  │         │      └── issues (inventoryTransactions type ISSUE, runId)
  │         ▼
  ├──▶ rolls ── runId, machineId, orderId, yarnLotIds
  │      ├──▶ qcInspections ──▶ signatures (PASS)
  │      └──▶ finishedGoods
  ├──▶ dispatches ── finishedGoodIds ──▶ signatures
  └──▶ invoices ── dispatchId

auditLogs (every important action)    idempotencyRecords (every mutating stock/production/sync call)
syncEvents (offline device events)    counters (business numbers)    costRates    locks
```

## 3. Collections

### users *(Phase 2)*
`name`, `email` (lowercase, **unique**), `passwordHash` (`select:false`), `role`
(`STORE_KEEPER|FLOOR_MANAGER|QC_INSPECTOR|BUYER|ADMIN`), `isActive`, `tokenVersion`, `lastLoginAt`,
`createdBy → users`, `buyerId → buyers` *(Phase 5; required iff role = BUYER)*, timestamps.

### buyers *(Phase 5)*
A buyer **company**. `code` (**unique**, e.g. `BUY-SRT`), `name`, `contactName`, `email`, `phone`,
`address`, `isActive`, timestamps. One company can have several BUYER users.
Ownership rule: a BUYER user sees only orders whose `buyerId` equals their own `buyerId`.

### products *(Phase 5)* — the fabric catalog
`code` (**unique**, e.g. `COT-NAVY-PLAIN`), `name`, `material`, `colour`, `machineType` (which
machines can make it, e.g. `WEAVING`), `yarnGramsPerMetre` (yarn consumed per metre, **including**
standard process waste), `defaultPricePerMetrePaise`, `isActive`.
This is what turns "5,000 m Navy Cotton" into "850 kg Navy Cotton yarn" (5,000 × 170 g/m).

### yarnLots *(Phase 3)* — one document per received batch
| Field | Notes |
|---|---|
| `lotNumber` | **unique**, supplier batch / GRN number |
| `material` | `COTTON|POLYESTER|VISCOSE|NYLON|WOOL|SILK|LINEN|BLEND` |
| `colour` | normalised Title Case (`navy blue` → `Navy Blue`) |
| `yarnCount` | optional, e.g. `40s` |
| `supplierName` | string |
| `costPerKgPaise` | integer |
| `receivedAt`, `receivedBy → users` | |
| `totalGrams` | physically in the store: received − issued + returned ± adjustments |
| `reservedGrams` | promised to orders, not yet issued |
| *available* | **computed**: `totalGrams − reservedGrams`, never stored |

**Invariant:** `0 ≤ reservedGrams ≤ totalGrams`, enforced by guarded atomic updates.
Indexes: `{ lotNumber: 1 }` unique; `{ material: 1, colour: 1, receivedAt: 1 }` for the catalog and
FIFO selection.

### inventoryTransactions *(Phase 3)* — the stock ledger (append-only)
`type`, `yarnLotId`, `deltaTotalGrams`, `deltaReservedGrams`, `orderId?`, `reservationId?`,
`runId?`, `reason?`, `actorId`, `idempotencyKey`, `createdAt`.

| type | Δ total | Δ reserved | Phase |
|---|---|---|---|
| `RECEIPT` | +q | 0 | 3 |
| `ADJUSTMENT` | ±q | 0 | 3 (ADMIN, reason required, cannot go below reserved) |
| `RESERVATION` | 0 | +q | 4 |
| `RESERVATION_RELEASE` | 0 | −q | 4 |
| `ISSUE` | −q | −q | 4 (reserved yarn handed to production) |
| `RETURN` | +q | 0 | 4 (unused yarn back from the floor) |

**Reconciliation rule:** for every lot, `Σ deltaTotalGrams = totalGrams` and
`Σ deltaReservedGrams = reservedGrams`. The lot holds the running balance (fast reads); the ledger
proves it. An ADMIN endpoint reports any lot where they disagree.
Indexes: `{ yarnLotId: 1, createdAt: 1 }`, `{ orderId: 1 }`, `{ runId: 1 }`.

### materialReservations *(Phase 4)*
`orderId`, `yarnLotId`, `reservedGrams`, `issuedGrams`, `releasedGrams`, `status`, `createdBy`, timestamps.
```
ACTIVE ──issue part──▶ PARTIALLY_ISSUED ──issue rest──▶ FULLY_ISSUED
  │                         │
  └──release/cancel─────────┴──▶ RELEASED   (remaining reserved grams return to available)
```

### orders *(Phase 5)*
`orderNumber` (**unique**), `buyerId`, `productId`, product snapshot (`material`, `colour`,
`yarnGramsPerMetre`, `pricePerMetrePaise`), `quantityCm`, `requiredYarnGrams` (computed),
`requiredBy` (deadline), `status`, `feasibility` (latest snapshot: `status`, `reasons[]`, `inputs`,
`computedAt`), `estimatedCompletionAt`, `createdBy`, `confirmedBy`, `version`, timestamps.

```
ORDER_CREATED ──confirm (runs feasibility)──▶ CONFIRMED ──reserve yarn──▶ MATERIAL_RESERVED
     │                                            │                           │
     └──reject──▶ REJECTED                        └──────cancel──────────────┴──▶ CANCELLED (releases reservations)

MATERIAL_RESERVED ──first run starts──▶ IN_PRODUCTION ──all runs complete──▶ PRODUCTION_COMPLETED
PRODUCTION_COMPLETED ──enough passed rolls──▶ READY_FOR_DISPATCH ──dispatch confirmed──▶ DISPATCHED ──▶ INVOICED
```
Buyer timeline (Phase 11) is a **view** over this status plus progress, not a separate state.

### machines *(Phase 7)*
`code` (**unique**, e.g. `W-03`), `name`, `type` (`SPINNING|WEAVING|DYEING|FINISHING`),
`ratedCmPerHour`, `status`, `currentRunId?`, `openProblemId?`, `version`, timestamps.

```
AVAILABLE ──assign run──▶ ASSIGNED ──start──▶ RUNNING ⇄ PAUSED
   ▲                         │                  │
   └──────unassign───────────┘                  └──complete──▶ AVAILABLE
RUNNING/PAUSED/ASSIGNED/AVAILABLE ──critical problem──▶ DOWN ──resolve──▶ AVAILABLE or PAUSED (run resumes later)
AVAILABLE ──schedule maintenance──▶ MAINTENANCE ──finish──▶ AVAILABLE
```
A machine in `DOWN` or `MAINTENANCE` can never start a run.

### machineEvents *(Phase 7)* — append-only
`machineId`, `runId?`, `type` (`STATUS_CHANGED|PROBLEM_REPORTED|PROBLEM_RESOLVED|MAINTENANCE_STARTED|MAINTENANCE_ENDED`),
`fromStatus`, `toStatus`, `problem` (`category: MECHANICAL|ELECTRICAL|MATERIAL|QUALITY|OTHER`,
`severity: LOW|MEDIUM|CRITICAL`, `description`, `estimatedDowntimeMinutes`), `resolvesEventId?`,
`actorId`, `occurredAt`, `source`. Downtime = `PROBLEM_REPORTED.occurredAt → PROBLEM_RESOLVED.occurredAt`.

### productionRuns *(Phase 8)*
`runNumber`, `orderId`, `machineId`, `targetCm`, `producedCm` (Σ roll lengths), `status`,
`plannedStartAt`, `startedAt`, `completedAt`, `supervisorId`, `version`, timestamps.
```
PLANNED ──start──▶ RUNNING ⇄ PAUSED ──complete──▶ COMPLETED
   └──cancel──▶ CANCELLED
```
Start requires: machine `ASSIGNED` to this run (not `DOWN`/`MAINTENANCE`), yarn issued for the
order, order in `MATERIAL_RESERVED` or `IN_PRODUCTION`.

### rolls *(Phase 9)*
`rollNumber` (**unique**), `orderId`, `runId`, `machineId`, `yarnLotIds[]` (lots issued to the run),
`lengthCm`, `weightGrams?`, `producedAt`, `producedBy`, `status`, `reworkCount`.
```
QC_PENDING ──PASS──▶ QC_PASSED ──▶ FINISHED (finishedGood created)
     │──REWORK──▶ IN_REWORK ──rework done──▶ QC_PENDING (re-inspect; history kept)
     └──REJECT──▶ REJECTED (terminal; never becomes stock)
```
Denormalised `machineId`/`orderId` let QC answer "which machine made this?" with one read.

### qcInspections *(Phase 10)* — append-only
`rollId`, `orderId`, `runId`, `machineId`, `attempt`, `inspectorId`, `result` (`PASS|REWORK|REJECT`),
`defects[]` (`type`, `severity`, `notes`), `notes`, `signatureId?` (PASS), `inspectedAt`.

### finishedGoods *(Phase 11)*
`rollId` (**unique** — one FG per roll), `orderId`, `buyerId`, `material`, `colour`, `lengthCm`,
`location`, `status` (`IN_STOCK → RESERVED_FOR_DISPATCH → DISPATCHED`), `dispatchId?`.

### dispatches *(Phase 12)*
`dispatchNumber`, `orderId`, `buyerId`, `finishedGoodIds[]`, `totalLengthCm`, `vehicleNumber`,
`status` (`PREPARED → CONFIRMED`, or `CANCELLED`), `preparedBy`, `confirmedBy`, `signatureId`.
Double-dispatch is impossible because a finished good moves `IN_STOCK → RESERVED_FOR_DISPATCH` with
a guarded update (`{ _id, status: 'IN_STOCK' }`) inside the dispatch transaction.

### invoices *(Phase 12)*
`invoiceNumber`, `orderId`, `dispatchId` (**unique**), `buyerId`, `lines[]` (`lengthCm`,
`pricePerMetrePaise`, `amountPaise`), `subtotalPaise`, `taxRateBasisPoints`, `taxPaise`, `totalPaise`, `issuedAt`.

### signatures *(Phases 10, 12)*
`signerId`, `signerRole`, `entityType` (`QC_INSPECTION|DISPATCH`), `entityId`, `statement`
(the exact sentence the signer agreed to), `contentHash` (SHA-256 of the canonical signed record),
`signatureImage` (small PNG data URL from the pad), `signedAt`. Unique `{ entityType, entityId }`.

### auditLogs *(written from Phase 3; query API Phase 13)* — append-only
`action` (e.g. `MATERIAL_RECEIVED`), `actorId`, `actorRole`, `entityType`, `entityId`, `orderId?`,
`machineId?`, `before?`, `after?`, `source` (`ONLINE|OFFLINE`), `requestId`, `idempotencyKey?`,
`correctsAuditId?`, `at`. The model rejects every update/delete operation.
Indexes: `{ entityType, entityId, at }`, `{ orderId, at }`, `{ actorId, at }`, `{ action, at }`.
Written **in the same transaction** as the business change it describes.

### idempotencyRecords *(Phase 3)*
`actorId`, `key`, `operation`, `requestHash`, `statusCode`, `responseBody`, `createdAt`.
**Unique `{ actorId, key }`** (scoped per user, so one user's key can never replay another user's response).

### syncEvents *(Phase 15)*
`eventId` (**unique**), `deviceId`, `actorId`, `type`, `entityId`, `baseVersion`, `payload`,
`clientCreatedAt`, `receivedAt`, `outcome` (`APPLIED|DUPLICATE|CONFLICT|REJECTED`), `errorCode?`.

### counters, costRates, locks
- `counters`: `{ _id: 'order:2026', seq }` incremented with `findOneAndUpdate($inc)` in the transaction.
- `costRates` *(Phase 14)*: versioned rate card (labour paise/hour, machine paise/hour by type,
  rework paise/roll, overhead basis points), each version effective from a date; costing records
  which version it used.
- `locks`: shared documents that force write conflicts where snapshot isolation would allow write
  skew (Phase 2: `user-admin-status`).

## 4. Inventory design

**Lot-based ledger.** Each receipt creates a lot. The lot stores running balances
(`totalGrams`, `reservedGrams`); every change also appends an `inventoryTransactions` row; both, plus
the audit log and the idempotency record, are written in **one MongoDB transaction**.

**Available ≠ reserved.** Available is `total − reserved`. Reserving moves grams from available into
reserved without changing total. Issuing to production removes them from both.

**Why the backend, not the frontend, decides.** Two store keepers looking at "1,250 kg available"
can both click "reserve 850 kg". Only one can win. The guard is a single atomic update:

```js
// succeeds only if enough is still available at the moment of the write
updateOne(
  { _id: lotId, $expr: { $gte: [{ $subtract: ['$totalGrams', '$reservedGrams'] }, grams] } },
  { $inc: { reservedGrams: grams } },
  { session },
)  // matchedCount 0 → 409 INSUFFICIENT_STOCK, transaction aborts, nothing else is written
```

## 5. Idempotency design

Every mutating stock, production and sync call carries a client-generated key
(`Idempotency-Key` header; for offline sync, the event id).

```
1. Look up (actorId, key).
   - found, same requestHash  → replay the stored response (header Idempotent-Replayed: true)
   - found, different hash    → 409 IDEMPOTENCY_KEY_REUSED
2. Otherwise open a transaction:
   business writes + ledger + audit + INSERT idempotencyRecord(response)
   → commit together, or none of it happens.
3. If two identical requests race, the second insert hits the unique index, its transaction aborts,
   and it replays the first one's stored response.
```
Only successful responses are stored; a failed attempt (e.g. insufficient stock) can be retried and
is re-evaluated against the current stock. This answers "the client got a timeout — did it
reserve or not?": retry with the same key; you either get the original result or it runs once.

## 6. Traceability

Given a roll id, one read of the roll returns `orderId`, `runId`, `machineId`, `yarnLotIds`,
`producedAt`. From there:

```
roll ──runId──▶ productionRun (start/end, supervisor) ──▶ machineEvents for that run (problems, downtime)
  ├──machineId──▶ machine
  ├──orderId──▶ order ──buyerId──▶ buyer
  ├──yarnLotIds──▶ yarnLots (supplier, lot number) ◀── ISSUE transactions with this runId
  ├──▶ qcInspections (every attempt, rework history) ──▶ signature
  └──▶ finishedGood ──▶ dispatch ──▶ invoice
```
Indexes on `rolls.{orderId,runId,machineId}`, `qcInspections.rollId`, `inventoryTransactions.runId`
keep each hop a single indexed query.

## 7. Decisions that need the owner's confirmation

These are not covered by the agreed defaults and change what we would defend to a judge.

| # | Decision | Proposed | Alternative |
|---|---|---|---|
| D1 | **Single-line orders** | One product per order ("5,000 m Navy Cotton"). Multi-line is future work | `items[]` with per-line feasibility, production and dispatch — roughly doubles Phases 5–12 |
| D2 | **Fabric catalog** (`products`) with `yarnGramsPerMetre` | Buyer picks a catalog product; yarn requirement is derived | Admin types the yarn requirement per order |
| D3 | **Single-stage production** | A run on one machine (type from the product) produces finished fabric rolls; spinning/dyeing are machine types but not chained stages | Multi-stage routing (spin → weave → dye) with WIP between stages |
| D4 | **Machine states**: `AVAILABLE, ASSIGNED, RUNNING, PAUSED, DOWN, MAINTENANCE` | **No `IDLE`**: it is indistinguishable from `AVAILABLE` in our model | Keep `IDLE` meaning "assigned but waiting" (= our `ASSIGNED`) |
| D5 | **Phase order** | Orders (Phase 5) **before** reservation (Phase 4): a reservation is always *for an order*. This matches `instruction.md` §25 (orders → feasibility → reservation) | Keep order and stub orders inside Phase 4 |
| D6 | **Labour cost** | Hourly rate × production-run hours from `costRates`; no attendance/wage module | Build attendance and wages (in the problem statement, not in the phase list) |
| D7 | **Stock adjustments** | ADMIN only, reason required, cannot reduce a lot below its reserved grams | Store Keeper may adjust; Admin reviews |
| D8 | **Idempotency records kept forever** | No TTL (hackathon data volume is small; offline devices may retry late) | 30-day TTL |
