# Production refinement — roles, signatures, status, notifications, insights

## Role responsibilities (backend is the authority; the UI mirrors it)
| Responsibility | Admin | Store keeper | Floor manager | QC inspector | Buyer |
|---|---|---|---|---|---|
| Receive yarn | ✓ | ✓ | | | |
| Edit yarn lot details (supplier, count, cost, lot no.; material/colour before use) | ✓ | ✓ | | | |
| Stock adjustments (ledger, reason, audited) | ✓ | ✓ | | | |
| Reserve yarn for a confirmed order | ✓ | | ✓ | | |
| Reopen a run completed by mistake (narrow, audited) | ✓ | | ✓ | | |
| Stock reconciliation (find discrepancies) | ✓ | ✓ | | | |
| Issue / return physical yarn | ✓ | ✓ | | | |
| Machines: maintenance, problems; production runs; rolls; rework done | ✓ | | ✓ | | |
| QC decisions (pass/rework/reject), cryptographically signed | ✓ | | | ✓ | |
| Prepare and sign dispatch (custody handoff) | ✓ | ✓ | | | |
| Confirm orders, invoices, users, master data, rate card, key rotation | ✓ | | | | |
| Own orders, timeline, invoices | ✓ | | | | ✓ own |

Changes from before: reservation moved from the store keeper to the floor manager; the store keeper may
now record adjustments and edit lot details (that edit did not exist at all before).

## Signatures
See [docs/SIGNATURES.md](../SIGNATURES.md). Every QC decision and every dispatch confirmation is signed on
the server with the user's own RSA key (RSA-PSS/SHA-256), verified before commit, and verifiable later.
There is no drawing pad: the signed-in user confirms with one button ("Confirm pass and sign as <name>",
"Confirm dispatch and sign as <name>"); the server then signs with that user's key. Signatures recorded
earlier with a drawing still show it as a handwritten acknowledgment.

The signing window shows the stages the server reports after it answers. Nothing is animated while the
single request runs. On failure, the failed stage is marked and nothing is approved. A safe retry is
offered only for temporary server failures, and always with the same idempotency key. If the connection
drops, the window shows "Result unconfirmed — checking server status": it resends with the same key, which
returns the stored result or applies the approval exactly once.

## Status colours
One map, `frontend/src/utils/statusTones.js`, drives one component, `<StatusBadge>`. Every badge shows an
icon and text, so colour is never the only signal:
- green: completed, passed, available, verified;
- amber: waiting, on hold, attention needed;
- red: failed, rejected, down, overdue;
- blue: in progress;
- grey: planned, inactive, cancelled.

Unknown states are grey, never green.

## Notifications, badges, insights
- `GET /api/summary/attention` returns role-scoped alerts and navigation badge counts from recorded data
  and the existing rules (feasibility, delivery risk, machine and QC states). Buyers see only their own
  orders.
- Sidebar badges show the counts. The dashboard's **Operational insights** panel lists what needs
  attention, why, which records, and what this user may do. This device's unsynced offline actions are
  included.
- Toasts: success only after the server confirmed (or "Saved offline — waiting to sync"). Errors stay
  until dismissed. Identical toasts are not stacked. A new high-priority alert warns once.

## Floor map
`/floor-map` (floor manager, admin) is the original Factory Floor Map design (`pages/Machines.jsx`,
`components/FactorySection.jsx`): same header, KPI cards, filters, section panels, tiles and summary table.
It is now fed by the real machine records (sections by machine type) and only the status colours changed:
**green** running, **yellow** idle/available (available, assigned, paused), **orange** maintenance, **red**
not working (down) or out of service (retired), with a legend. The demo data, "Telemetry Active" and
"Simulated Feed" claims were removed; a tile opens the machine page. See `master-task.md`.

## Production recovery and shortages
- A run completed by mistake (below target, order still in production) can be **reopened** by the floor
  manager with a reason, or the remaining quantity planned as a continuation run from the order page. The
  run page explains both when a completed run ended short.
- Yarn shortages (new or confirmed orders) are routed to the **store keeper** (alert, badge, dashboard),
  who resolves them by receiving yarn or correcting stock (reconciliation and adjustments). The admin is
  told the store keeper resolves it; the floor manager reserves once yarn is there.

## Wording
Sample-data screens and the development account list appear only in development builds. "Live data"
suffixes and "signed pass" wording were replaced with precise terms.

## Manual verification
1. `cd backend && npm run dev` (with `SIGNING_KEY_ENCRYPTION_KEY` in `.env`; see `.env.example`).
   `cd frontend && npm run dev`.
2. **Store keeper**: Yarn inventory → Lots → Edit → change the supplier → "Yarn details saved". Adjust
   −1 kg with a reason; the lot's ledger shows the adjustment. Users and Costing are not in the menu.
3. **Floor manager**: open a confirmed order → Reserve yarn. Record a roll on a running run.
4. **QC inspector**: Quality control → Inspect → choose a result (add a defect for rework or reject) →
   tick the statement → Sign. The window lists the server's stages and "Cryptographic signature
   verified." → View verification details → "all checks passed".
5. **Store keeper**: Dispatch → Prepare → Dispatches tab → Confirm → tick → Sign and confirm.
6. Roll page: every inspection shows "Cryptographically signed" with a Verify button.
7. Offline: DevTools → Offline → inspect a roll. It shows "Saved offline — waiting to sync… not approved
   yet". Go back online; it is applied once and signed by the server.

## Tests
Backend: `signing.test.js` (14), `attention.test.js` (5), `inventory.edit.test.js` (6), role changes in
`reservation`, `inventory.adjust`, `quality`, `fulfilment`, `sync` tests, and the RBAC matrix.
Frontend: `signingStages.test.js`, `statusTones.test.js`. Real browser (Edge, throwaway DB): 33 checks
across the store keeper, QC signing, dispatch, role isolation and offline scenarios.
