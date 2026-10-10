import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TONES, toneOf } from './statusTones.js';

test('failure states are never green; completed states are', () => {
  assert.equal(toneOf('ROLL', 'REJECTED'), 'danger');
  assert.equal(toneOf('QC_RESULT', 'REJECT'), 'danger');
  assert.equal(toneOf('MACHINE', 'DOWN'), 'danger');
  assert.equal(toneOf('RISK', 'LATE'), 'danger');
  assert.equal(toneOf('ORDER', 'INVOICED'), 'success');
  assert.equal(toneOf('DISPATCH', 'CONFIRMED'), 'success');
});

test('waiting and hold states are amber', () => {
  assert.equal(toneOf('ROLL', 'IN_REWORK'), 'warning');
  assert.equal(toneOf('DISPATCH', 'PREPARED'), 'warning');
  assert.equal(toneOf('ORDER', 'ORDER_CREATED'), 'warning');
});

test('unknown states fall back to neutral, not success', () => {
  assert.equal(toneOf('ORDER', 'SOMETHING_NEW'), 'neutral');
  assert.equal(toneOf('NOPE', 'X'), 'neutral');
});

test('only the five semantic tones are used', () => {
  const used = new Set(Object.values(TONES).flatMap((map) => Object.values(map)));
  assert.deepEqual([...used].sort(), ['danger', 'info', 'neutral', 'success', 'warning']);
});
