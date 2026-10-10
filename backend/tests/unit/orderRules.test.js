import { ALL_ORDER_STATUSES, ORDER_STATUS, allowedNextStatuses, canTransition } from '../../src/constants/orderStatus.js';
import { calculateOrderFigures, formatOrderNumber } from '../../src/services/order.service.js';
import { addYears, dateStringToDate, dateToDateString, todayInIndia } from '../../src/utils/dates.js';

describe('calculateOrderFigures', () => {
  it('turns 5,000 m of Navy Cotton at 170 g/m into 850 kg of yarn (the CLAUDE.md example)', () => {
    const figures = calculateOrderFigures(500_000, { yarnGramsPerMetre: 170, pricePerMetrePaise: 18000 });

    expect(figures).toEqual({ requiredYarnGrams: 850_000, orderValuePaise: 90_000_000 });
  });

  it('rounds yarn UP so production is never under-planned', () => {
    // 0.01 m × 170 g/m = 1.7 g → 2 g
    expect(calculateOrderFigures(1, { yarnGramsPerMetre: 170, pricePerMetrePaise: 100 }).requiredYarnGrams).toBe(2);
  });

  it('rounds value to the nearest paisa', () => {
    // 0.01 m × 150 paise/m = 1.5 paise → 2; 0.01 m × 149 = 1.49 → 1
    expect(calculateOrderFigures(1, { yarnGramsPerMetre: 1, pricePerMetrePaise: 150 }).orderValuePaise).toBe(2);
    expect(calculateOrderFigures(1, { yarnGramsPerMetre: 1, pricePerMetrePaise: 149 }).orderValuePaise).toBe(1);
  });

  it('stays exact at the maximum order size', () => {
    const figures = calculateOrderFigures(100_000_000, { yarnGramsPerMetre: 10_000, pricePerMetrePaise: 10_000_000 });
    expect(Number.isSafeInteger(figures.requiredYarnGrams)).toBe(true);
    expect(Number.isSafeInteger(figures.orderValuePaise)).toBe(true);
  });
});

describe('formatOrderNumber', () => {
  it('pads the sequence to four digits and grows beyond', () => {
    expect(formatOrderNumber('2026', 7)).toBe('ORD-2026-0007');
    expect(formatOrderNumber('2026', 12345)).toBe('ORD-2026-12345');
  });
});

describe('order transition table', () => {
  it('allows cancelling or rejecting a newly created order', () => {
    expect(canTransition(ORDER_STATUS.ORDER_CREATED, ORDER_STATUS.CANCELLED)).toBe(true);
    expect(canTransition(ORDER_STATUS.ORDER_CREATED, ORDER_STATUS.REJECTED)).toBe(true);
  });

  it('allows confirming a newly created order (the service gates it on feasibility)', () => {
    expect(canTransition(ORDER_STATUS.ORDER_CREATED, ORDER_STATUS.CONFIRMED)).toBe(true);
  });

  it('lets a confirmed order only be reserved or cancelled (not rejected, not re-confirmed)', () => {
    expect(allowedNextStatuses(ORDER_STATUS.CONFIRMED)).toEqual([ORDER_STATUS.MATERIAL_RESERVED, ORDER_STATUS.CANCELLED]);
  });

  it.each([ORDER_STATUS.CANCELLED, ORDER_STATUS.REJECTED])('treats %s as terminal', (status) => {
    expect(allowedNextStatuses(status)).toEqual([]);
    for (const to of ALL_ORDER_STATUSES) expect(canTransition(status, to)).toBe(false);
  });

  it('never allows a status to transition to itself', () => {
    for (const status of ALL_ORDER_STATUSES) expect(canTransition(status, status)).toBe(false);
  });
});

describe('dates', () => {
  it('uses the Indian calendar day: 20:00 UTC is already the next day in India', () => {
    expect(todayInIndia(new Date('2026-10-10T18:29:00Z'))).toBe('2026-10-10');
    expect(todayInIndia(new Date('2026-10-10T18:30:00Z'))).toBe('2026-10-11');
  });

  it('adds whole years to a date string', () => {
    expect(addYears('2026-10-10', 2)).toBe('2028-10-10');
  });

  it('round-trips a calendar date', () => {
    expect(dateToDateString(dateStringToDate('2026-12-31'))).toBe('2026-12-31');
  });
});
