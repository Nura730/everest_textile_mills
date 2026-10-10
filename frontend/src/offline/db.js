import Dexie from 'dexie';

/**
 * The device's offline store (Phases 15-16), in IndexedDB so it survives a refresh or a closed tab.
 * Everything is tagged with the user who wrote it; one person's data is never shown to, or sent as,
 * another person. No passwords or tokens are stored here.
 *
 * queue: actions waiting to be sent
 *   { eventId, userId, type, payload, label, recordedAt, status, attempts, lastAttemptAt, nextAttemptAt, message, ref }
 * cache: the last server response of a screen, to show while offline
 *   { key: `${userId}|${queryKey}`, userId, data, meta, savedAt }
 * meta: small per-user facts, e.g. { key: `${userId}|lastSyncAt`, userId, value }
 */
export const offlineDb = new Dexie('everest-offline');
offlineDb.version(1).stores({ queue: '&eventId, userId, status, recordedAt' });
offlineDb.version(2).stores({
  queue: '&eventId, userId, status, recordedAt',
  cache: '&key, userId, savedAt',
  meta: '&key, userId',
});
