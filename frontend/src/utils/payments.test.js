import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paymentTone } from './payments.js';

test('payment colours: paid green, overdue red, partly paid blue, unpaid amber', () => {
  assert.equal(paymentTone({ status: 'PAID', overdue: false }), 'success');
  assert.equal(paymentTone({ status: 'UNPAID', overdue: true }), 'danger');
  assert.equal(paymentTone({ status: 'PARTIALLY_PAID', overdue: false }), 'info');
  assert.equal(paymentTone({ status: 'UNPAID', overdue: false }), 'warning');
  assert.equal(paymentTone(null), 'neutral');
});
