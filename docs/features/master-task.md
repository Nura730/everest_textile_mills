# System audit fixes, delivery workflow, attendance and wages

The server is the authority for every rule below; the screens mirror it.

## A. Buyer order timeline
`ordersApi.timeline` was missing in `frontend/src/api/endpoints.js` (the backend route
`GET /api/orders/:id/timeline` existed). It is added, and `api/endpoints.contract.test.js` now fails if
any screen calls an API method that `endpoints.js` does not define. The timeline also lists each
dispatched consignment with its delivery state.

## B. Production completed below target
- `POST /api/production-runs/:id/complete` on a run below its target needs `shortfallReason` (5+
  characters); without it: `400 SHORTFALL_REASON_REQUIRED` with produced/target/short metres. The reason
  is stored in the run history ("Completed short by 100 m: …") and in the `RUN_COMPLETED` audit entry.
- Recovery: reopen the run (`POST /:id/reopen`, if it was a mistake) or plan a continuation run for the
  remaining quantity. Rolls can never take an order past its quantity (`409 QUANTITY_EXCEEDS_ORDER`).
- More yarn: `POST /api/orders/:id/reserve-additional { quantityKg, reason }` (floor manager, admin;
  order reserved or in production; at most one full requirement per request). FIFO from **free** stock
  only, never from other orders' reservations; all or nothing. If the store is short:
  `409 INSUFFICIENT_STOCK` with available and missing kg. The store keeper then receives yarn (nothing is
  created out of thin air). The store issues the new reservation as usual (issuing now works while
  the order is in production).
- Tested: 500 m order → 400 m completed with a reason → +20 kg reserved and issued → continuation run
  of 100 m → order `PRODUCTION_COMPLETED`, two runs, 500 m, no duplicates.

## C. Maintenance cost
`POST /api/machines/:id/maintenance/end { costPaise, note? }` requires the cost (integer paise, 0
allowed, negative refused). It is not asked at the start. It is stored once on the append-only
`MAINTENANCE_ENDED` machine event and in the audit entry; a retry with the same Idempotency-Key replays
the stored result. **Accounting:** a machine/factory expense, shown in Costing under "Factory expenses
(not allocated to orders)" per machine. It is not added to order cost or profit: there is no agreed
allocation rule, and order costing already includes a machine-hour rate.

## D/H. Delivery after dispatch
Dispatch status (PREPARED → CONFIRMED) is unchanged and still signed by the store keeper. A confirmed
dispatch then has a separate **delivery status**:

```
CONFIRMED (dispatched, signed) → IN_TRANSIT
IN_TRANSIT  --buyer confirms (own dispatch) / admin confirms for the buyer with a proof note-->  DELIVERED
IN_TRANSIT | DELIVERED  --buyer or admin reports a problem (description)-->  DISCREPANCY
DELIVERED  --admin verifies-->  VERIFIED
DISCREPANCY --admin verifies with a resolution note-->  VERIFIED
VERIFIED  --admin issues the invoice (once)-->  invoiced
```

- Endpoints: `POST /api/dispatches/:id/delivery/confirm | /discrepancy | /verify` (Idempotency-Key).
  Each step records who (role) and when, and appears in the audit and the buyer's milestones. A second
  confirmation is refused (409). Other buyers get 404.
- `POST /api/dispatches/:id/invoice` before verification: `409 DELIVERY_NOT_VERIFIED`, naming the next step.
- Confirmed dispatches recorded before this change have no delivery status and read as IN_TRANSIT.
- Dispatched, delivered, buyer-confirmed, admin-verified and invoiced remain distinct; the order status
  lifecycle is unchanged (DISPATCHED → INVOICED when every confirmed dispatch is invoiced).
- **Revenue rule:** revenue is recognised only from issued invoices (one per dispatch, never edited),
  excluding GST. Before invoicing, Costing shows the order value as *expected* revenue. Delivery
  confirmation and verification do not create revenue, so nothing is counted twice.
- Next actions in the UI: the buyer sees *Confirm delivery / Report problem* on the order. The admin sees
  *Confirm for buyer* / *Verify delivery* and then *Issue invoice* on the Dispatch → Dispatches tab, plus
  attention alerts ("deliveries to verify", "ready to invoice"). The store keeper sees "Waiting for the
  buyer to confirm receipt".

## E. Invoices open
Every invoice number links to `/invoices/:id` (a printable page): the invoice list, the order's dispatch
panel, the dispatch list ("View invoice"), and the page opened after issuing. Access stays server-side:
admin, or the buyer company that owns it (404 for anyone else).

## F. Shortages
Shortage alerts go to the store keeper, who can receive yarn and reconcile/adjust stock. Shortage
report (attention alert) ≠ reservation (floor manager) ≠ issue/transfer to the floor (store) ≠
replenishment/receipt (store, a goods-received entry). Nothing is ever reserved from stock that is not
there.

## G. Floor map
Original design kept (see `production-refinement.md` → Floor map). Only the status colours and a legend
were added; counts come from the machine records.

## Workers, attendance and wages
- **Worker** (`/api/workers`): unique code, name, department, wage basis (DAILY/HOURLY), rate in paise,
  active flag. Managed by the admin; a rate change applies only to entries recorded afterwards.
- **Attendance** (`/api/attendance`): one entry per worker per Indian calendar day (unique index;
  a second one is refused with the existing entry's id). PRESENT / HALF_DAY / ABSENT, hours for
  hourly-rated workers. No future dates. Corrections (`PATCH /api/attendance/:id`) need a reason and the
  `expectedUpdatedAt`; before/after, author and reason are kept on the entry and in the audit. Filters:
  date or from/to, worker, department, status. Day register: `GET /api/attendance/register?date=`.
- **Wage rules** (server only, `services/wage.service.js`), snapshotted on each entry:
  daily present = rate; daily half day = rate × `HALF_DAY_WAGE_FACTOR_BP` / 10,000 (default 5000 =
  50%, env-configurable); hourly = hours × rate; absent = 0. Rounded to the paisa.
- **Summaries** (`GET /api/wages/summary?from&to[&department]`, admin): per worker and per department.
  Costing shows this month's wages as a separate factory labour expense, not allocated to orders. Order
  labour stays the machine-hour estimate, so the two are never added together.
- **Offline:** `ATTENDANCE_RECORD` sync events replay through the same service: once only; a duplicate
  day is a CONFLICT, never a second wage.
- **Roles:** admin manages workers, records, corrects any day, sees wages. Floor manager records and
  corrects the last 7 days and sees no money. QC reads the register only. Store keeper and buyers have no
  access. Audit entries strip money fields for everyone but the admin.
- Screens: Attendance (daily register, offline-capable), Workers, Wages.

## Tests
Backend: `workforce.test.js` (9), `wages.test.js` (unit, 5), delivery tests in `fulfilment.test.js`,
shortfall and top-up tests in `production.test.js` / `production.recovery.test.js`, maintenance cost in
`machines.test.js`, new rows in the RBAC matrix. Frontend: `endpoints.contract.test.js`,
`delivery.test.js`, `floorMap.test.js`, `attendance.test.js`. Browser (Edge, throwaway DB):
`master-sweep.mjs`, 67 checks.
