# Phase 7 — Machines (registry, maintenance, problems, downtime)

> Decision D4 confirmed by the owner: no `IDLE`; states are `AVAILABLE, ASSIGNED, RUNNING, PAUSED,
> DOWN, MAINTENANCE`. `ASSIGNED`, `RUNNING` and `PAUSED` are entered by production runs (Phase 8).

## Users
- **ADMIN**: registers machines, edits name / rated speed / location, retires or reactivates; also operates.
- **FLOOR_MANAGER**: starts and finishes maintenance, reports and resolves problems (instruction.md §8).
- **QC_INSPECTOR**: views machines and their history (rolls will come from machines).
- **STORE_KEEPER, BUYER**: no access.

## Problem
Machine status was only on a sample-data floor map: nobody could see which machine was down, why, or
for how long, and Phase 8 needs real machines to run production on.

## Business rules
1. A machine has a unique code (e.g. `W-03`) and a type (spinning, weaving, dyeing, finishing); both
   identify it and cannot be edited. Rated speed is stored as integer cm/h.
2. Maintenance: only `AVAILABLE → MAINTENANCE → AVAILABLE`. A busy (`ASSIGNED`/`RUNNING`/`PAUSED`) or
   `DOWN` machine cannot go into maintenance.
3. Problems: category, severity, description, optional estimated downtime. **CRITICAL** takes the machine
   `DOWN` from any working state (or maintenance) and remembers where it was. LOW/MEDIUM are recorded and
   stay open without changing the status; "pause production" pauses a `RUNNING` machine and is refused
   otherwise.
4. Resolving: each problem once (unique index). When the last open critical problem of a `DOWN` machine is
   resolved it returns to where it was; `RUNNING`/`PAUSED` come back `PAUSED` (a person resumes the run),
   `MAINTENANCE` comes back `AVAILABLE`.
5. `DOWN` and `MAINTENANCE` machines can never start a run (enforced by Phase 8's start).
6. Retire, never delete; not while production is booked or running. Retired machines refuse actions.
7. Every change: guarded status update + append-only machine event + audit entry, one transaction, under a
   per-machine lock; status actions take an Idempotency-Key.
8. Downtime = critical problem reported → resolved (an open one counts up to now).

## Data
`machines`, `machineEvents`; `locks/machine:<id>`; audit entries with `machineId`. See `docs/DATABASE.md`.

## API
See `backend/README.md` → Machines (Phase 7): list/get/history for viewers; create/edit/retire for ADMIN;
maintenance and problem actions for FLOOR_MANAGER and ADMIN.

## UI
Machines (live): list with type/status/search filters and open-problem counts; detail with status,
downtime, open problems (Resolve), Report problem (critical warns it takes the machine down), Start /
Finish maintenance, admin Edit and Retire, filterable history. The sample Factory Floor Map moved to
`/floor-map` and stays labelled as a preview. Floor dashboard: machines available / down / in maintenance.

## Edge cases
Duplicate code; invalid type/speed; editing code/type/status (400); stale edit (409); maintenance from a
busy or down machine; second critical problem on a down machine; resolving one of two critical problems
(stays down); two critical problems resolved at the same moment (machine still comes back — the lock
test fails without the lock); critical during maintenance; pause with nothing running; resolving twice or
on the wrong machine; retired machine actions; retiring a running machine; retries with the same key.

## Audit events
`MACHINE_CREATED`, `MACHINE_UPDATED`, `MACHINE_ACTIVE_CHANGED`, `MACHINE_MAINTENANCE_STARTED`,
`MACHINE_MAINTENANCE_ENDED`, `MACHINE_PROBLEM_REPORTED`, `MACHINE_PROBLEM_RESOLVED`.

## Tests
`tests/unit/machines.test.js`, `tests/integration/machines.test.js`, RBAC matrix rows for the ten routes.
