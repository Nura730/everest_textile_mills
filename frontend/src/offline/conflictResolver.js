// Pure rules for the offline queue (Phase 15): how to batch events and what each server outcome means
// for the queued item. No browser APIs here, so it is unit-tested with node --test.

/** Server limit is 100 KB per request; stay well below it. A signature alone can be ~60 KB. */
export const MAX_BATCH_BYTES = 80_000;
export const MAX_BATCH_EVENTS = 25;

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
 * What to do with a queued item given the server's result:
 *   DONE      applied (now or earlier): remove it from the queue;
 *   CONFLICT  the factory changed while offline: keep it for the user to review;
 *   REJECTED  can never succeed: keep it for the user to review;
 *   PENDING   not processed (RETRY): send again later.
 */
export function resolveOutcome(result) {
  const outcome = result.outcome === 'DUPLICATE' ? result.originalOutcome : result.outcome;
  if (outcome === 'APPLIED') return { status: 'DONE' };
  if (outcome === 'CONFLICT') {
    return { status: 'CONFLICT', message: `${result.error?.message ?? 'The record changed while you were offline.'} Check the current state and redo the action if it is still needed.` };
  }
  if (outcome === 'REJECTED') return { status: 'REJECTED', message: result.error?.message ?? 'The server refused this action.' };
  return { status: 'PENDING' };
}
