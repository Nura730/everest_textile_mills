import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveOutcome, toBatches } from './conflictResolver.js';

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
  assert.deepEqual(resolveOutcome({ outcome: 'RETRY' }), { status: 'PENDING' });
});
