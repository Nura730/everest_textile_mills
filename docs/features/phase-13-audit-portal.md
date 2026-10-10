# Phase 13 and buyer portal — Audit center and order timeline

## Business rules
1. Every role reads the audit trail, limited to the actions of its work (instruction.md §13); the admin sees
   everything and filters by person, role, order, machine, action, entity and date.
2. Money fields are removed from before/after for everyone but the admin; buyers get plain-language
   milestones of their own orders only, with no internals.
3. History is append-only; a correction is a new `AUDIT_CORRECTION` entry pointing at the original.
4. Administrative changes (account created, activated/deactivated) are audited in the same transaction.
5. The buyer timeline is a view over the order's status history and progress (produced %, QC passed,
   dispatched) with the expected delivery; it shows no machines, lots, costs or people.

## UI
Audit trail page (staff; admin filters and corrections). Order detail shows the buyer their timeline.

## Tests
`tests/integration/audit.center.test.js`, RBAC matrix rows.
