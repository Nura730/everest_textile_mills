import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deliveryActionsFor } from './delivery.js';

const at = (status) => ({ delivery: status ? { status } : null });

test('buyer confirms or reports while in transit; can still report after confirming; nothing after verification', () => {
  assert.deepEqual(deliveryActionsFor('BUYER', at('IN_TRANSIT')), ['confirm', 'discrepancy']);
  assert.deepEqual(deliveryActionsFor('BUYER', at('DELIVERED')), ['discrepancy']);
  assert.deepEqual(deliveryActionsFor('BUYER', at('DISCREPANCY')), []);
  assert.deepEqual(deliveryActionsFor('BUYER', at('VERIFIED')), []);
});

test('admin confirms for the buyer while in transit and verifies confirmed or disputed deliveries', () => {
  assert.deepEqual(deliveryActionsFor('ADMIN', at('IN_TRANSIT')), ['confirm']);
  assert.deepEqual(deliveryActionsFor('ADMIN', at('DELIVERED')), ['verify']);
  assert.deepEqual(deliveryActionsFor('ADMIN', at('DISCREPANCY')), ['verify']);
  assert.deepEqual(deliveryActionsFor('ADMIN', at('VERIFIED')), []);
});

test('store, floor and QC have no delivery step; a dispatch not yet confirmed has none', () => {
  for (const role of ['STORE_KEEPER', 'FLOOR_MANAGER', 'QC_INSPECTOR']) assert.deepEqual(deliveryActionsFor(role, at('IN_TRANSIT')), []);
  assert.deepEqual(deliveryActionsFor('BUYER', at(null)), []);
});
