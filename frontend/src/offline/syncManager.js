import { ApiError, apiRequest } from '../api/client.js';
import {
  afterTemporaryFailure,
  canRetry,
  classifyBatchError,
  isDue,
  QUEUE_STATUS,
  resolveOutcome,
  toBatches,
} from './conflictResolver.js';
import { offlineDb } from './db.js';

/*
 * The offline queue and sync engine (instruction.md §14-15). Components never sync by themselves:
 * they call runOrQueue() for an offline-capable action and read the queue through subscribe().
 *
 * - An action that cannot reach the server is stored (IndexedDB) BEFORE the user is told it was saved.
 *   Its idempotency key is the eventId, so if the online attempt actually reached the server and only
 *   the reply was lost, the queued copy replays the stored result instead of applying twice.
 * - While older actions are still waiting, new ones queue behind them, so actions on the same record
 *   are always applied in the order they were made.
 * - flush() sends due items oldest first in size-limited batches to POST /api/sync/events. One run
 *   at a time per tab, and one tab at a time (Web Locks), so two triggers never send the same items
 *   concurrently; even if they did, the server applies each eventId at most once.
 * - Results: applied → removed; conflict/rejected → kept with the server's reason and the user's input
 *   for review; temporary failure → retried with backoff, then FAILED for a manual retry; expired
 *   session → paused until the same user signs in again; no connection → nothing changes.
 */

const listeners = new Set();
const syncedListeners = new Set();
const state = { userId: null, syncing: false, pausedReason: null, lastSyncAt: null };
let flushing = null; // { userId, promise }
/** A sync request that hangs is abandoned after this long and retried later with the same eventIds. */
const SYNC_TIMEOUT_MS = 30_000;

function notify() {
  listeners.forEach((listener) => listener());
}

/** Subscribe to queue/state changes; returns an unsubscribe function. */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called with the queue items that were just applied on the server: [{ eventId, type, ref, result }]. */
export function onSynced(listener) {
  syncedListeners.add(listener);
  return () => syncedListeners.delete(listener);
}

export const syncState = () => ({ ...state });

/** A stable id for this browser, kept in localStorage (a fresh one if storage is unavailable). */
export function deviceId() {
  try {
    let id = localStorage.getItem('everest-device-id');
    if (!id) {
      id = `web-${crypto.randomUUID()}`;
      localStorage.setItem('everest-device-id', id);
    }
    return id;
  } catch {
    return `web-${crypto.randomUUID()}`;
  }
}

/** The user's queue, oldest first. Another user's items are never returned. */
export async function queuedItems(userId) {
  if (!userId) return [];
  try {
    return await offlineDb.queue.where('userId').equals(userId).sortBy('recordedAt');
  } catch {
    return []; // IndexedDB unavailable (private window): nothing queued
  }
}

export async function dismiss(eventId) {
  await offlineDb.queue.delete(eventId);
  notify();
}

/** Puts a FAILED item back in line and sends it now. */
export async function retryItem(eventId) {
  const item = await offlineDb.queue.get(eventId);
  if (!item || !canRetry(item)) return;
  await offlineDb.queue.update(eventId, { status: QUEUE_STATUS.PENDING, attempts: 0, nextAttemptAt: null, message: null });
  notify();
  await flush({ force: true });
}

async function enqueue({ eventId, type, payload, label, ref }, userId) {
  // put() on the eventId: pressing the button twice with the same key stores the action once.
  await offlineDb.queue.put({
    eventId,
    userId,
    type,
    payload,
    label,
    ref: ref ?? null,
    recordedAt: new Date().toISOString(),
    status: QUEUE_STATUS.PENDING,
    attempts: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    message: null,
  });
  notify();
}

async function hasWaiting(userId) {
  return (await queuedItems(userId)).some((item) => item.status === QUEUE_STATUS.PENDING);
}

/**
 * Runs an offline-capable action. `call(key)` sends it online with `key` as its Idempotency-Key.
 * Returns { queued: false, result } when the server answered, or { queued: true } when it was stored
 * on this device. `ref` ({ runId } / { orderId } / …) lets screens show the pending action in place.
 */
export async function runOrQueue({ key, type, payload, label, ref, userId }, call) {
  const save = async () => {
    await enqueue({ eventId: key, type, payload, label, ref }, userId);
    if (typeof navigator === 'undefined' || navigator.onLine !== false) flush().catch(() => {});
    return { queued: true };
  };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return save();
  if (await hasWaiting(userId)) return save(); // keep the order of actions
  try {
    return { queued: false, result: await call(key) };
  } catch (error) {
    if (error instanceof ApiError && error.isNetworkError) return save();
    throw error;
  }
}

async function markTemporaryFailure(items, message) {
  for (const item of items) await offlineDb.queue.update(item.eventId, afterTemporaryFailure(item, message));
}

async function markRejected(items, message) {
  for (const item of items) {
    await offlineDb.queue.update(item.eventId, { status: QUEUE_STATUS.REJECTED, message, lastAttemptAt: new Date().toISOString() });
  }
}

/** Sends one batch. Returns 'continue' to go on with the next batch, or 'stop'. */
async function sendBatch(items, applied) {
  let response;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SYNC_TIMEOUT_MS);
  try {
    response = await apiRequest('/sync/events', {
      method: 'POST',
      body: { deviceId: deviceId(), events: items.map(({ eventId, type, payload, recordedAt }) => ({ eventId, type, payload, recordedAt })) },
      signal: controller.signal,
    });
  } catch (error) {
    // A timeout may mean the server applied it: resending later with the same eventIds is safe.
    const kind = error?.name === 'AbortError' ? 'RETRY' : classifyBatchError(error, items.length);
    if (kind === 'OFFLINE') return 'stop';
    if (kind === 'AUTH') {
      state.pausedReason = 'AUTH';
      return 'stop';
    }
    if (kind === 'SPLIT') {
      for (const item of items) if ((await sendBatch([item], applied)) === 'stop') return 'stop';
      return 'continue';
    }
    if (kind === 'REJECT') {
      await markRejected(items, error.message);
      return 'continue';
    }
    await markTemporaryFailure(items, error?.name === 'AbortError' ? 'The server did not answer in time.' : error.message);
    return 'stop';
  } finally {
    clearTimeout(timer);
  }

  const byId = new Map(items.map((item) => [item.eventId, item]));
  let next = 'continue';
  for (const result of response.data.results) {
    const item = byId.get(result.eventId);
    if (!item) continue;
    const verdict = resolveOutcome(result);
    if (verdict.status === 'DONE') {
      await offlineDb.queue.delete(item.eventId);
      applied.push({ eventId: item.eventId, type: item.type, ref: item.ref, label: item.label, result: result.result });
    } else if (verdict.status === 'RETRY') {
      await markTemporaryFailure([item], verdict.message);
      next = 'stop'; // later actions wait for this one
    } else {
      await offlineDb.queue.update(item.eventId, { status: verdict.status, message: verdict.message, lastAttemptAt: new Date().toISOString() });
    }
  }
  state.lastSyncAt = new Date().toISOString();
  await offlineDb.meta.put({ key: `${state.userId}|lastSyncAt`, userId: state.userId, value: state.lastSyncAt }).catch(() => {});
  return next;
}

async function runFlush({ force }) {
  const userId = state.userId;
  const pending = (await queuedItems(userId)).filter((item) => item.status === QUEUE_STATUS.PENDING);
  // The oldest action decides: if it is still backing off, everything after it waits too.
  if (!pending.length || !isDue(pending[0], Date.now(), force)) return [];
  const applied = [];
  state.syncing = true;
  notify();
  try {
    const byId = new Map(pending.map((item) => [item.eventId, item]));
    const batches = toBatches(pending.map(({ eventId, type, payload, recordedAt }) => ({ eventId, type, payload, recordedAt })));
    for (const batch of batches) {
      if ((await sendBatch(batch.map((e) => byId.get(e.eventId)), applied)) === 'stop') break;
    }
  } finally {
    state.syncing = false;
    notify();
  }
  if (applied.length) syncedListeners.forEach((listener) => listener(applied));
  return applied;
}

/** Sends the signed-in user's due items. Safe to call from any number of triggers at once. */
export function flush({ force = false } = {}) {
  if (!state.userId || state.pausedReason === 'AUTH') return Promise.resolve([]);
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve([]);
  if (flushing?.userId === state.userId) return flushing.promise; // one run per tab and user
  const run = () => runFlush({ force });
  const locked =
    typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('everest-offline-sync', { ifAvailable: true }, (lock) => (lock ? run() : []))
      : run();
  const entry = { userId: state.userId, promise: null };
  entry.promise = Promise.resolve(locked).finally(() => {
    if (flushing === entry) flushing = null;
  });
  flushing = entry;
  return entry.promise;
}

/** Starts syncing for the signed-in user: now, on reconnect, when the tab becomes visible, and every 15 s. */
export function startAutoSync(userId) {
  state.userId = userId;
  state.pausedReason = null; // a fresh sign-in by this user resumes a paused queue
  state.lastSyncAt = null;
  offlineDb.meta
    .get(`${userId}|lastSyncAt`)
    .then((row) => {
      if (row && state.userId === userId) {
        state.lastSyncAt = row.value;
        notify();
      }
    })
    .catch(() => {});
  const trigger = () => flush().catch(() => {});
  const onVisible = () => document.visibilityState === 'visible' && trigger();
  window.addEventListener('online', trigger);
  document.addEventListener('visibilitychange', onVisible);
  const timer = setInterval(trigger, 15_000);
  trigger();
  notify();
  return () => {
    window.removeEventListener('online', trigger);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(timer);
    if (state.userId === userId) Object.assign(state, { userId: null, syncing: false, pausedReason: null, lastSyncAt: null });
    notify();
  };
}
