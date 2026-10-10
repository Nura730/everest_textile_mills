// Pure rules for the offline queue (Phases 15-16): batching, what each server outcome means for a queued
// item, how failed sends back off, and what can be retried. No browser APIs here, so every rule is
// unit-tested with node --test (conflictResolver.test.js).

/** Server limit is 100 KB per request; stay well below it. A signature alone can be ~60 KB. */
export const MAX_BATCH_BYTES = 80_000;
export const MAX_BATCH_EVENTS = 25;
/** After this many failed sends (server or network trouble) an item stops retrying by itself. */
export const MAX_AUTO_ATTEMPTS = 8;

/** Queue item states. */
export const QUEUE_STATUS = Object.freeze({
  PENDING: 'PENDING', // waiting to be sent (also after a temporary failure, with a backoff)
  FAILED: 'FAILED', // temporary failures repeated too often: the user retries it
  CONFLICT: 'CONFLICT', // the record changed meanwhile: the user reviews it
  REJECTED: 'REJECTED', // can never succeed as recorded: the user reviews it
});

/** Splits events (already in recorded order) into batches that respect the size and count limits. */
export function toBatches(events, { maxBytes = MAX_BATCH_BYTES, maxEvents = MAX_BATCH_EVENTS } = {}) {
  const batches = [];
  let current = [];
  let bytes = 0;
  for (const event of events) {
    const size = JSON.stringify(event).length;
    if (current.length && (bytes + size > maxBytes || current.length >= maxEvents)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(event);
    bytes += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

/**
 * What to do with a queued item given the server's result for it:
 *   DONE      applied (now, or earlier on a previous send): remove it from the queue;
 *   CONFLICT  the record changed while offline: keep it, with the user's input, for review;
 *   REJECTED  can never succeed as recorded: keep it for review;
 *   RETRY     not processed (temporary server trouble): send again later.
 */
export function resolveOutcome(result) {
  const outcome = result.outcome === 'DUPLICATE' ? result.originalOutcome : result.outcome;
  if (outcome === 'APPLIED') return { status: 'DONE' };
  if (outcome === 'CONFLICT') {
    return {
      status: QUEUE_STATUS.CONFLICT,
      message: `${result.error?.message ?? 'The record changed while you were offline.'} Check the current state and redo the action if it is still needed.`,
    };
  }
  if (outcome === 'REJECTED') return { status: QUEUE_STATUS.REJECTED, message: result.error?.message ?? 'The server refused this action.' };
  return { status: 'RETRY', message: result.error?.message ?? null };
}

/**
 * How a failed request for a whole batch is handled:
 *   OFFLINE  no connection: stop, nothing changes (not counted as an attempt);
 *   AUTH     session expired or revoked: stop and wait for the same user to sign in again;
 *   SPLIT    the batch itself was refused as invalid: resend items one by one to find the bad one;
 *   REJECT   refused for good (forbidden, or one invalid item): mark the items REJECTED;
 *   RETRY    server trouble: back off and try again later.
 */
export function classifyBatchError(error, batchSize) {
  if (!error || error.code === 'NETWORK_ERROR' || error.status === 0) return 'OFFLINE';
  if (error.status === 401) return 'AUTH';
  if (error.status === 400 || error.status === 413) return batchSize > 1 ? 'SPLIT' : 'REJECT';
  if (error.status === 403) return 'REJECT';
  return 'RETRY';
}

/** Delay before the next automatic send: 5 s, 10 s, 20 s … capped at 5 minutes. */
export function backoffMs(attempts) {
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, attempts - 1));
}

/** The item's state after one more temporary failure. */
export function afterTemporaryFailure(item, message, now = Date.now()) {
  const attempts = (item.attempts ?? 0) + 1;
  if (attempts >= MAX_AUTO_ATTEMPTS) {
    return { attempts, lastAttemptAt: new Date(now).toISOString(), status: QUEUE_STATUS.FAILED, nextAttemptAt: null, message: message ?? 'Could not be sent after several tries.' };
  }
  return { attempts, lastAttemptAt: new Date(now).toISOString(), status: QUEUE_STATUS.PENDING, nextAttemptAt: new Date(now + backoffMs(attempts)).toISOString(), message: message ?? null };
}

/** Is this item due to be sent now? (`force` = the user pressed "Sync now".) */
export function isDue(item, now = Date.now(), force = false) {
  if (item.status !== QUEUE_STATUS.PENDING) return false;
  return force || !item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= now;
}

/** Only FAILED items are retried by the user; conflicts and rejections need a decision, not a resend. */
export function canRetry(item) {
  return item.status === QUEUE_STATUS.FAILED;
}
