// Run with `npm test` (Node's built-in test runner; no extra dependencies).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addYears, rupeesToPaise } from './format.js';

describe('rupeesToPaise', () => {
  it('converts rupees with up to 2 decimals exactly', () => {
    assert.equal(rupeesToPaise('320'), 32000);
    assert.equal(rupeesToPaise('320.5'), 32050);
    assert.equal(rupeesToPaise('320.50'), 32050);
    assert.equal(rupeesToPaise('0.01'), 1);
    assert.equal(rupeesToPaise(' 180.00 '), 18000);
    assert.equal(rupeesToPaise('0'), 0);
  });

  it('avoids float error (19.99 × 100 is 1998.9999… in floating point)', () => {
    assert.equal(rupeesToPaise('19.99'), 1999);
    assert.equal(rupeesToPaise('1.15'), 115);
  });

  it('rejects instead of rounding: more than 2 decimals, negatives, junk', () => {
    for (const input of ['320.999', '320.005', '-5', '', ' ', 'abc', '1e3', '12.', '.5', '1,000']) {
      assert.equal(rupeesToPaise(input), null, `expected ${JSON.stringify(input)} to be rejected`);
    }
  });
});

describe('addYears', () => {
  it('matches the backend string arithmetic', () => {
    assert.equal(addYears('2026-10-10', 2), '2028-10-10');
    assert.equal(addYears('2026-12-31', 2), '2028-12-31');
  });
});
