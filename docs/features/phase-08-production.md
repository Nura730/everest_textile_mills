# Phase 8 — Production runs and roll output

> D3 (single-stage production) applied as proposed: a run on one machine of the fabric's type turns
> yarn into finished fabric rolls. Spinning and dyeing machines exist but are not chained stages.

## Users
- **FLOOR_MANAGER, ADMIN**: plan runs, start / pause / resume / complete / cancel them, record rolls.
- **STORE_KEEPER, QC_INSPECTOR**: follow runs and their rolls (the store issues yarn, QC inspects rolls).
- **BUYER**: sees the order move to "In production" and "Production completed"; never runs or machines.

## Problem
`instruction.md` §7: a production run connects order, machine, material, target and actual output, times
and status, and must validate before starting that material is there, the machine is available and not
under maintenance or a critical problem.

## Business rules
1. Plan: order `MATERIAL_RESERVED` or `IN_PRODUCTION`; machine active, `AVAILABLE`, of the product's
   machine type; target ≤ what is left of the order (open runs count their target, completed runs their
   output). The machine becomes `ASSIGNED` to the run. An order can be split across machines.
2. Start: the run is `PLANNED`; its machine is `ASSIGNED` to it (never `DOWN`/`MAINTENANCE`); yarn of the
   order is on the floor (issued − returned > 0). Run and machine `RUNNING`; the first start moves the order
   `MATERIAL_RESERVED → IN_PRODUCTION`. An order in production can no longer be cancelled.
3. Pause / resume move run and machine together (reason required to pause). A critical machine problem, or
   any problem with "pause production", pauses the running run; resume needs the machine back to `PAUSED`.
4. Output: each roll is recorded with length (≤ 2 decimals) and optional weight, while the run is
   `RUNNING` or `PAUSED`. The roll stores its order, run, machine and the yarn lots issued to the order,
   and starts `QC_PENDING`. `producedMetres` = Σ roll lengths.
5. Complete: needs ≥ 1 roll; frees the machine (a `DOWN` machine stays down but will return `AVAILABLE`).
   When no run of the order is open and completed output ≥ ordered quantity the order becomes
   `PRODUCTION_COMPLETED`; otherwise it stays `IN_PRODUCTION` for another run.
6. Cancel: only `PLANNED` runs; the machine is freed and the quantity can be planned again. Cancelling a
   reserved order cancels its planned runs.
7. Every action: guarded run + machine updates, run history, machine event, audit entry, Idempotency-Key,
   one transaction, with `order:<id>` and `machine:<id>` locks (two runs completing at once still complete
   the order; the test fails without the locks).

## Data
`productionRuns`, `rolls`; `machines.currentRunId`; machine events with `runId`; `orders.status`.

## UI
Production (live): runs with status/machine filters and progress; Plan run; run detail with start / pause /
resume / record roll / complete / cancel, rolls with their yarn lots, and run history. Order detail:
Production panel (runs, produced vs ordered, Plan run). Machine detail links to its current run. The sample
production board moved to `/production-board` and stays labelled as a preview.

## Not done here
Machine-capacity check in feasibility (needs working hours per day: an owner decision); roll traceability
views and labels (Phase 9); QC (Phase 10).

## Tests
`tests/integration/production.test.js` (every rule above, concurrency), RBAC matrix rows for the nine routes.
