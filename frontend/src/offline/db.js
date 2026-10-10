import Dexie from 'dexie';

/**
 * The device's offline store (Phase 15), in IndexedDB so queued work survives a refresh or a closed
 * tab. One table: actions waiting to be sent, tagged with the user who recorded them, so one
 * person's queue is never replayed under another person's login.
 *
 * queue item: { eventId, userId, type, payload, label, recordedAt, status: PENDING|CONFLICT|REJECTED, message }
 */
export const offlineDb = new Dexie('everest-offline');
offlineDb.version(1).stores({ queue: '&eventId, userId, status, recordedAt' });
