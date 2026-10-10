# Phases 9-10 — Roll traceability and quality control

## Users
- **QC_INSPECTOR, ADMIN**: inspect rolls (PASS signed, REWORK, REJECT with defects).
- **FLOOR_MANAGER, ADMIN**: finish rework (roll back to the QC queue).
- **STORE_KEEPER, FLOOR_MANAGER, QC_INSPECTOR, ADMIN**: list rolls and trace any roll.

## Business rules
1. A roll answers which order, run and machine produced it, when, how much and from which yarn lots
   (stored on the roll at production; traced in one call).
2. Only `QC_PENDING` rolls are inspected; each inspection is a new append-only record (attempt 1, 2, …).
3. REWORK and REJECT need at least one defect; PASS needs the inspector's signature (statement accepted +
   drawn image). The signature is stored once per roll with a SHA-256 hash of the signed record.
4. REWORK → `IN_REWORK`; the floor marks rework done → `QC_PENDING` as the next attempt. History is kept.
5. REJECT is terminal: the roll can never be inspected again or become finished stock.
6. A per-roll lock: two inspectors cannot both record a result for the same roll.

## UI
Quality control (live): queue oldest first, rolls in rework, pass/rework/reject rates, recent inspections;
inspect form with defects, notes and the signature pad. Rolls (live): list with search and status, roll
trace page with order, run, machine, yarn lots, QC history and the signed pass. The sample QC board moved
to `/quality-board` (preview).

## Tests
`tests/integration/quality.test.js`, RBAC matrix rows for the six routes.
