import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  afterTemporaryFailure,
  backoffMs,
  canRetry,
  classifyBatchError,
  isDue,
  MAX_AUTO_ATTEMPTS,
  resolveOutcome,
  toBatches,
} from './conflictResolver.js';

test('toBatches respects size and count limits and keeps order', () => {
  const small = (n) => ({ eventId: String(n), payload: { x: 'a' } });
  const big = { eventId: 'sig', payload: { image: 'x'.repeat(60_000) } };
  const batches = toBatches([small(1), small(2), big, small(3)], { maxBytes: 60_050, maxEvents: 25 });
  assert.deepEqual(batches.map((b) => b.map((e) => e.eventId)), [['1', '2'], ['sig'], ['3']]);
  assert.equal(toBatches(Array.from({ length: 30 }, (_, i) => small(i)), { maxEvents: 25 }).length, 2);
  assert.deepEqual(toBatches([]), []);
});

test('resolveOutcome maps server outcomes to queue states', () => {
  assert.deepEqual(resolveOutcome({ outcome: 'APPLIED' }), { status: 'DONE' });
  assert.deepEqual(resolveOutcome({ outcome: 'DUPLICATE', originalOutcome: 'APPLIED' }), { status: 'DONE' });
  assert.equal(resolveOutcome({ outcome: 'DUPLICATE', originalOutcome: 'CONFLICT', error: { message: 'Run is completed.' } }).status, 'CONFLICT');
  assert.match(resolveOutcome({ outcome: 'CONFLICT', error: { message: 'Run is completed.' } }).message, /^Run is completed\. Check/);
  assert.deepEqual(resolveOutcome({ outcome: 'REJECTED', error: { message: 'Bad data' } }), { status: 'REJECTED', message: 'Bad data' });
  assert.equal(resolveOutcome({ outcome: 'RETRY' }).status, 'RETRY');
});

test('classifyBatchError separates offline, expired session, invalid, forbidden and server trouble', () => {
  assert.equal(classifyBatchError({ code: 'NETWORK_ERROR', status: 0 }, 3), 'OFFLINE');
  assert.equal(classifyBatchError({ status: 401, code: 'TOKEN_EXPIRED' }, 3), 'AUTH');
  assert.equal(classifyBatchError({ status: 400 }, 3), 'SPLIT');
  assert.equal(classifyBatchError({ status: 400 }, 1), 'REJECT');
  assert.equal(classifyBatchError({ status: 403 }, 1), 'REJECT');
  assert.equal(classifyBatchError({ status: 503 }, 2), 'RETRY');
  assert.equal(classifyBatchError({ status: 429 }, 2), 'RETRY');
});

test('temporary failures back off and stop after a bounded number of attempts', () => {
  assert.deepEqual([1, 2, 3, 10].map(backoffMs), [5_000, 10_000, 20_000, 300_000]);
  const now = Date.parse('2026-10-11T10:00:00Z');
  const once = afterTemporaryFailure({ attempts: 0 }, 'Server busy', now);
  assert.equal(once.status, 'PENDING');
  assert.equal(once.nextAttemptAt, '2026-10-11T10:00:05.000Z');
  assert.equal(isDue({ ...once }, now), false);
  assert.equal(isDue({ ...once }, now + 5_000), true);
  assert.equal(isDue({ ...once }, now, true), true);
  const last = afterTemporaryFailure({ attempts: MAX_AUTO_ATTEMPTS - 1 }, null, now);
  assert.equal(last.status, 'FAILED');
  assert.equal(isDue(last, now, true), false); // a failed item is not resent until the user retries it
  assert.equal(canRetry(last), true);
  assert.equal(canRetry({ status: 'CONFLICT' }), false);
  assert.equal(canRetry({ status: 'REJECTED' }), false);
});
