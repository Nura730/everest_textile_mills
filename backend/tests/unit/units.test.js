import { normalizeCode, toTitleCase } from '../../src/utils/normalize.js';
import { cmToMetres, gramsToKg, hasAtMostDecimals, kgToGrams, metresToCm } from '../../src/utils/units.js';

describe('units', () => {
  it.each([
    [850, 850000],
    [0.001, 1],
    [1250.5, 1250500],
    [0.1 + 0.2, 300], // float noise is rounded away
  ])('kgToGrams(%p) = %p', (kg, grams) => {
    expect(kgToGrams(kg)).toBe(grams);
  });

  it('converts grams back to kg', () => {
    expect(gramsToKg(1250500)).toBe(1250.5);
    expect(gramsToKg(1)).toBe(0.001);
  });

  it('converts metres and centimetres', () => {
    expect(metresToCm(420.5)).toBe(42050);
    expect(cmToMetres(42050)).toBe(420.5);
  });

  it('sums integer grams exactly where float kg would drift', () => {
    const kgValues = Array.from({ length: 10 }, () => 0.1);
    const floatSum = kgValues.reduce((a, b) => a + b, 0);
    const gramSum = kgValues.map(kgToGrams).reduce((a, b) => a + b, 0);

    expect(floatSum).not.toBe(1);
    expect(gramSum).toBe(1000);
  });

  it.each([
    [1, 3, true],
    [1.5, 3, true],
    [1.123, 3, true],
    [0.1 + 0.2, 3, true],
    [1.1234, 3, false],
    [1.25, 1, false],
  ])('hasAtMostDecimals(%p, %p) = %p', (value, places, expected) => {
    expect(hasAtMostDecimals(value, places)).toBe(expected);
  });
});

describe('normalize', () => {
  it.each([
    ['navy blue', 'Navy Blue'],
    ['  Navy   BLUE ', 'Navy Blue'],
    ['off-white', 'Off-White'],
    ['RED', 'Red'],
  ])('toTitleCase(%p) = %p', (input, expected) => {
    expect(toTitleCase(input)).toBe(expected);
  });

  it('normalises codes', () => {
    expect(normalizeCode(' grn-2026 / 104 ')).toBe('GRN-2026/104');
  });
});
