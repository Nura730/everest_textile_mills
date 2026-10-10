# Phases 11-12 — Finished goods, dispatch and invoices

## Users
- **STORE_KEEPER, ADMIN**: move finished goods, prepare / confirm (signed) / cancel dispatches.
- **ADMIN**: issues invoices. **BUYER**: reads own dispatches and invoices.

## Business rules
1. A QC pass creates exactly one finished good for the roll (unique by roll); rejected rolls never do.
2. An order is `READY_FOR_DISPATCH` when production is complete, no roll waits for QC or rework, and at
   least one finished good is in stock (checked after each QC result and after the last run completes).
3. Only in-stock goods of the order can be dispatched; reservation is a guarded update per good, so a roll
   cannot be in two dispatches; duplicates and foreign or already-reserved goods are refused.
4. Final dispatch is signed by the store keeper ("…have been dispatched."), with a hash of the rolls and
   lengths; the goods become `DISPATCHED`; the order becomes `DISPATCHED` when nothing is left in stock
   (partial dispatches keep it ready).
5. A prepared dispatch can be cancelled (goods back in stock); a confirmed one cannot.
6. One invoice per confirmed dispatch, at the order's agreed price; GST 5% is a stated assumption;
   issued invoices are never edited. The order becomes `INVOICED` when every confirmed dispatch is invoiced.

## UI
Dispatch (live): ready orders → prepare (choose rolls, vehicle), dispatches (confirm with signature pad,
cancel, issue invoice), finished goods stock (search, move). Invoices (live, printable). Order detail shows
dispatches and, for admin and the buyer, invoices. Sample dispatch board moved to `/dispatch-board`.

## Tests
`tests/integration/fulfilment.test.js`, RBAC matrix rows for eleven routes.
