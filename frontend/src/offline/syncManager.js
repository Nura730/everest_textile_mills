import { ApiError, apiRequest } from '../api/client.js';
import { resolveOutcome, toBatches } from './conflictResolver.js';
import { offlineDb } from './db.js';

/*
 * Phase 15: the offline queue. When a floor or QC action cannot reach the server, it is saved on the
 * device with its idempotency key as the eventId, and sent to POST /api/sync/events when the
 * connection returns. Because the eventId IS the key the online attempt used, an action whose
 * response was lost (applied on the server, but the device never heard back) is not applied twice.
 */

const listeners = new Set();
let flushing = false;
let currentUserId = null;

function notify() {
  listeners.forEach((listener) => listener());
}

/** Subscribe to queue changes; returns an unsubscribe function. */
export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

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

async function enqueue({ eventId, type, payload, label }, userId) {
  await offlineDb.queue.put({ eventId, userId, type, payload, label, recordedAt: new Date().toISOString(), status: 'PENDING', message: null });
  notify();
}

/**
 * Runs an online action; if the server cannot be reached, saves it to the queue instead.
 * `call(key)` must send the action with `key` as its Idempotency-Key.
 * Returns { queued: false, result } or { queued: true }.
 */
export async function runOrQueue({ key, type, payload, label, userId }, call) {
  const save = async () => {
    await enqueue({ eventId: key, type, payload, label }, userId);
    return { queued: true };
  };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return save();
  try {
    return { queued: false, result: await call(key) };
  } catch (error) {
    if (error instanceof ApiError && error.isNetworkError) return save();
    throw error;
  }
}

/** Sends the signed-in user's pending items, oldest first. Stops quietly if still offline. */
export async function flush(userId = currentUserId) {
  if (!userId || flushing) return;
  flushing = true;
  notify();
  try {
    const pending = (await queuedItems(userId)).filter((item) => item.status === 'PENDING');
    const events = pending.map(({ eventId, type, payload, recordedAt }) => ({ eventId, type, payload, recordedAt }));
    for (const batch of toBatches(events)) {
      let response;
      try {
        response = await apiRequest('/sync/events', { method: 'POST', body: { deviceId: deviceId(), events: batch } });
      } catch (error) {
        if (error instanceof ApiError && (error.isNetworkError || error.status >= 500)) break; // try later
        throw error;
      }
      for (const result of response.data.results) {
        const next = resolveOutcome(result);
        if (next.status === 'DONE') await offlineDb.queue.delete(result.eventId);
        else if (next.status !== 'PENDING') await offlineDb.queue.update(result.eventId, { status: next.status, message: next.message });
      }
    }
  } finally {
    flushing = false;
    notify();
  }
}

export const isFlushing = () => flushing;

/** Called by the sync status component for the signed-in user: flush on reconnect and every 30 s. */
export function startAutoSync(userId) {
  currentUserId = userId;
  const onOnline = () => flush(userId).catch(() => {});
  window.addEventListener('online', onOnline);
  const timer = setInterval(onOnline, 30_000);
  onOnline();
  return () => {
    window.removeEventListener('online', onOnline);
    clearInterval(timer);
    if (currentUserId === userId) currentUserId = null;
  };
}
