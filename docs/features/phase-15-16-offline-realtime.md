# Phases 15-16 — Offline-first and realtime updates

## What works offline
**Reading.** Screens the user has opened keep their last server response in IndexedDB, per user: orders and
order detail, the order form's catalog, production runs and run detail, machines and machine detail, the QC
queue, roll detail, yarn lots and stock summary. Offline they show that data under an "Offline. Showing what
this device saved at …" notice; online the server is always asked first. A service worker (production
build) keeps the app shell, so the app opens after a refresh without a connection; it never caches `/api`.

**Writing.** These actions are saved on the device when the server cannot be reached and sent later:

| Action | Who | Why it is safe to queue |
|---|---|---|
| Pause / resume / complete a run, record a roll | Floor manager, admin | Facts from the floor; the server re-checks the run state |
| Report a machine problem | Floor manager, admin | A report; the server applies it to the current machine state |
| QC inspection (with signature), finish rework | QC / floor, admin | The server re-checks the roll state |
| Place an order | Buyer, admin | Only a request: nothing is confirmed until the admin confirms it online |
| Edit an order | Buyer, admin | Carries the version it was based on; a change made meanwhile → conflict |
| Record a yarn receipt | Store keeper, admin | Records goods that arrived; only adds stock; duplicate lot numbers refused |

**Online only** (buttons disabled with "Needs a connection", or the request explains it): confirming,
rejecting or cancelling orders (live feasibility), reserving/issuing/returning yarn and adjustments (live
balances), planning/starting/cancelling runs, maintenance and problem resolution, finished goods, dispatch
sign-off, invoices, users and master data, rate card, audit corrections.

## Rules
1. An action is stored in IndexedDB before the user is told "Saved offline — waiting to sync"; success
   messages that mention the server appear only after the server answered.
2. Every queued action has a UUID that is both its eventId and its Idempotency-Key, so a resend, a second
   tab, or an online attempt whose reply was lost never applies it twice.
3. Actions are sent oldest first. While older ones wait, new actions queue behind them. After a server
   error the rest of the batch waits.
4. Results: applied → removed, and the screen reloads the server's record. Conflict → kept with the
   server's reason and what the user entered, until dismissed. Rejected (invalid, forbidden) → kept,
   never retried. Server trouble → retried with backoff (5 s doubling to 5 min), after 8 tries marked
   "Sync failed — your changes are saved on this device" with Retry. Expired session → the user is
   signed out, nothing is lost, and sync resumes when the same user signs in.
5. One sync at a time per tab and per browser (Web Locks); a sync request is abandoned after 30 s and
   retried with the same ids.
6. Queue and cache rows carry the user id: another person signing in on the same browser neither sees nor
   sends them. Signing out clears the user's cache (their queued actions stay and sync at their next sign-in).
   No password or token is written to IndexedDB; the token stays in sessionStorage as before.
7. Offline after a refresh, a stored unexpired session opens the app from the saved public profile; it is
   re-verified with the server as soon as the connection returns, and a late answer can never revive a
   session that was ended meanwhile.

## UI
Header chip: Online / Offline / Live, waiting count, syncing, last successful sync, failed and conflicted
items with Retry / Discard. Each record shows its own pending actions ("Not yet on the server").

## Tests
- Backend: `tests/integration/sync.test.js` (orders, receipts, completion, roles per action, conflicts,
  lost response, ordering after a server failure), RBAC matrix.
- Frontend: `src/offline/conflictResolver.test.js` (batching, outcomes, error classes, backoff, retry rules).
- Real browser (Microsoft Edge via playwright-core, production build, throwaway database): 25 checks
  covering offline refresh, persistence, reconnect, lost replies, conflicts, user switching, expired
  session, permission failure, backoff, interrupted sync and concurrent triggers.

## Manual check
1. `cd frontend && npm run build && npx vite preview --port 5173` (backend running on :4000).
2. Sign in as the buyer, open Orders and the order form once, close it.
3. DevTools → Network → Offline. Reload: the app opens; Orders shows the "Offline" notice.
4. Place an order: "Saved offline — waiting to sync"; it is listed under "Orders saved on this device";
   the header shows "1 waiting to sync". Reload: still there.
5. Network → No throttling: within seconds "Synced successfully", the order appears with its number.
6. Repeat step 4 as the floor manager on a running run (record roll, pause): the run page lists them.
