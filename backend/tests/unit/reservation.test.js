import { onFloorGrams, openGrams, reservationStatus } from '../../src/models/MaterialReservation.js';
import { planFifoAllocation } from '../../src/services/material.service.js';

const lot = (lotNumber, totalGrams, reservedGrams = 0) => ({ _id: lotNumber, lotNumber, totalGrams, reservedGrams });

describe('planFifoAllocation', () => {
  it('takes from the oldest lot first and only what is needed', () => {
    const plan = planFifoAllocation([lot('A', 500_000), lot('B', 1_000_000)], 850_000);
    expect(plan.map((p) => [p.lot.lotNumber, p.grams])).toEqual([['A', 500_000], ['B', 350_000]]);
  });

  it('skips reserved yarn and empty lots', () => {
    const plan = planFifoAllocation([lot('A', 500_000, 500_000), lot('B', 0), lot('C', 900_000, 100_000)], 800_000);
    expect(plan.map((p) => [p.lot.lotNumber, p.grams])).toEqual([['C', 800_000]]);
  });

  it('uses a single lot when it covers the requirement', () => {
    expect(planFifoAllocation([lot('A', 900_000)], 850_000)).toHaveLength(1);
  });

  it('returns null when all lots together fall short (never a partial plan)', () => {
    expect(planFifoAllocation([lot('A', 400_000), lot('B', 449_999)], 850_000)).toBeNull();
    expect(planFifoAllocation([], 1)).toBeNull();
  });

  it('covers an exact match to the gram', () => {
    expect(planFifoAllocation([lot('A', 425_000), lot('B', 425_000)], 850_000).reduce((s, p) => s + p.grams, 0)).toBe(850_000);
  });
});

describe('reservation counters and status', () => {
  const r = (reservedGrams, issuedGrams = 0, releasedGrams = 0, returnedGrams = 0) => ({ reservedGrams, issuedGrams, releasedGrams, returnedGrams });

  it('derives open and on-floor quantities', () => {
    expect(openGrams(r(850, 300, 0))).toBe(550);
    expect(onFloorGrams(r(850, 300, 0, 100))).toBe(200);
  });

  it.each([
    ['nothing issued', r(850), 'ACTIVE'],
    ['part issued', r(850, 300), 'PARTIALLY_ISSUED'],
    ['all issued', r(850, 850), 'FULLY_ISSUED'],
    ['released before any issue', r(850, 0, 850), 'RELEASED'],
    ['part issued, rest released', r(850, 300, 550), 'RELEASED'],
  ])('%s → %s', (_label, reservation, status) => {
    expect(reservationStatus(reservation)).toBe(status);
  });
});
