import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ORDER_STEPS, isCompletedOrder, stepStates } from './orderStatus.js';

const history = (...statuses) => statuses.map((to) => ({ to }));
const ALL = ORDER_STEPS.map((s) => s.status);

test('an invoiced order is complete: every step ticked, none "current"', () => {
  const order = { status: 'INVOICED', statusHistory: history(...ALL) };
  assert.equal(isCompletedOrder(order), true);
  assert.deepEqual(stepStates(order), ALL.map(() => 'done'));
});

test('a dispatched order: earlier steps done, Dispatched current, Invoiced upcoming', () => {
  const order = { status: 'DISPATCHED', statusHistory: history(...ALL.slice(0, 7)) };
  const states = stepStates(order);
  assert.equal(states[6], 'current');
  assert.equal(states[7], 'upcoming');
  assert.ok(states.slice(0, 6).every((s) => s === 'done'));
  assert.equal(isCompletedOrder(order), false);
});

test('a cancelled order is marked at the last stage it reached', () => {
  const order = { status: 'CANCELLED', statusHistory: history('ORDER_CREATED', 'CONFIRMED', 'CANCELLED') };
  assert.deepEqual(stepStates(order).slice(0, 3), ['done', 'stopped', 'upcoming']);
});
