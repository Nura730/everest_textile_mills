# Phases 15-16 — Offline sync and realtime updates

## Offline (Phase 15)
1. Floor and QC actions that cannot reach the server are saved on the device (IndexedDB via Dexie):
   pausing/resuming a run, recording a roll, reporting a machine problem, QC inspection with signature,
   finishing rework. Each queued item is tagged with the signed-in user; only that user's items are sent.
2. The queue is sent on reconnect, every 30 seconds while items wait, or with "Sync now", in batches
   under the server's body limit, oldest first.
3. The server applies each event through the normal service (same rules, locks, audit with source OFFLINE),
   at most once per eventId. The eventId is the action's online idempotency key, so a request whose
   response was lost is never applied twice.
4. Conflicts (the record changed meanwhile) and rejections stay in the header panel with the server's
   reason until the user dismisses them; nothing is silently dropped or overwritten.
5. Not offline (need fresh server truth): order entry and confirmation, material reservation and issue,
   dispatch and invoices, costing.

## Realtime (Phase 16)
1. One Socket.IO connection per signed-in session, authenticated with the API token.
2. Only committed changes are pushed (change stream on the audit log), filtered and shaped per role exactly
   as in the audit center; buyers receive milestones of their own orders only.
3. Pages refresh themselves when a relevant change arrives (orders, order detail, production, runs,
   machines, QC, rolls, inventory, dispatch, audit trail). The header shows Live / Online / Offline and
   the number of actions waiting to sync.

## Tests
Backend: `tests/integration/sync.test.js`, `tests/integration/realtime.test.js`, RBAC matrix rows.
Frontend: `src/offline/conflictResolver.test.js` (batching, outcome mapping).
E2E (throwaway DB, through the Vite proxy): 17 checks incl. lost-response replay and proxied WebSocket.
