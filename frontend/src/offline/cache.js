import { offlineDb } from './db.js';

/*
 * Read cache (offline-first reading). Each screen's last successful server response is kept per user
 * in IndexedDB; when the server cannot be reached the screen shows it, marked with the time it was
 * saved. Nothing here is ever presented as fresh: the caller gets `savedAt` and must show it.
 *
 * Keys are scoped by the signed-in user (set by the auth layer), so a buyer can never see another
 * buyer's cached data, and a user's cache is removed when they sign out.
 */

let cacheUserId = null;

export function setCacheUser(userId) {
  cacheUserId = userId ?? null;
}

const fullKey = (key) => `${cacheUserId}|${key}`;

export async function writeCache(key, { data, meta }) {
  if (!cacheUserId || !key) return;
  try {
    await offlineDb.cache.put({ key: fullKey(key), userId: cacheUserId, data, meta: meta ?? null, savedAt: new Date().toISOString() });
  } catch {
    // Storage full or unavailable (private window): reading offline is simply not possible then.
  }
}

/** { data, meta, savedAt } or null. */
export async function readCache(key) {
  if (!cacheUserId || !key) return null;
  try {
    const row = await offlineDb.cache.get(fullKey(key));
    return row && row.userId === cacheUserId ? { data: row.data, meta: row.meta, savedAt: row.savedAt } : null;
  } catch {
    return null;
  }
}

/** Removes one user's cached screens (sign-out). */
export async function clearCacheFor(userId) {
  try {
    await offlineDb.cache.where('userId').equals(userId).delete();
  } catch {
    // nothing cached
  }
}

/** Removes every other user's cached screens from this browser (a different person signed in). */
export async function clearOtherUsersCache(userId) {
  try {
    await offlineDb.cache.where('userId').notEqual(userId).delete();
  } catch {
    // nothing cached
  }
}
