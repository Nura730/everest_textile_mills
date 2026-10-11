import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeAvailability } from './dispatchAvailability.js';

const base = {
  dispatchableMetres: 0,
  inStock: { rolls: 0, metres: 0 },
  reserved: { rolls: 0, metres: 0, dispatches: [] },
  dispatched: { rolls: 0, metres: 0 },
  awaitingQc: { rolls: 0, metres: 0 },
  rejected: { rolls: 0, metres: 0 },
  reason: null,
  message: null,
};

test('shows the dispatchable quantity the server returned', () => {
  const d = describeAvailability({ ...base, dispatchableMetres: 1200, inStock: { rolls: 2, metres: 1200 } });
  assert.equal(d.canPrepare, true);
  assert.match(d.label, /1,200/);
});

test('the reported case: everything reserved in a prepared dispatch → no prepare, exact reason', () => {
  const d = describeAvailability({
    ...base,
    reserved: { rolls: 2, metres: 1200, dispatches: [{ dispatchNumber: 'DSP-2026-0002', metres: 1200 }] },
    reason: 'RESERVED_IN_PREPARED_DISPATCH',
    message: 'All finished goods (1,200 m) are already in DSP-2026-0002, waiting for the signed confirmation.',
  });
  assert.equal(d.canPrepare, false);
  assert.equal(d.label, 'Nothing to prepare');
  assert.match(d.detail, /DSP-2026-0002/);
});

test('partial stock lists what else exists, never offers more than in stock', () => {
  const d = describeAvailability({ ...base, dispatchableMetres: 700, inStock: { rolls: 1, metres: 700 }, rejected: { rolls: 1, metres: 500 }, awaitingQc: { rolls: 1, metres: 200 } });
  assert.equal(d.canPrepare, true);
  assert.match(d.label, /700/);
  assert.match(d.detail, /awaiting QC/);
  assert.match(d.detail, /500 m rejected/);
});

test('missing data never enables prepare', () => {
  assert.equal(describeAvailability(null).canPrepare, false);
});
