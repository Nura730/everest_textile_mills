import { computeWage, hoursToMinutes } from '../../src/services/wage.service.js';

const daily = { wageBasis: 'DAILY', ratePaise: 60_000, halfDayFactorBp: 5000 }; // ₹600 a day
const hourly = { wageBasis: 'HOURLY', ratePaise: 9_000, halfDayFactorBp: 5000 }; // ₹90 an hour

describe('computeWage', () => {
  it('daily: present = rate, half day = rate × factor, absent = 0', () => {
    expect(computeWage({ ...daily, status: 'PRESENT', minutes: null })).toEqual({ minutes: null, wagePaise: 60_000 });
    expect(computeWage({ ...daily, status: 'HALF_DAY', minutes: null })).toEqual({ minutes: null, wagePaise: 30_000 });
    expect(computeWage({ ...daily, status: 'ABSENT', minutes: null })).toEqual({ minutes: null, wagePaise: 0 });
  });

  it('the half-day factor is configurable and rounds to the paisa', () => {
    expect(computeWage({ ...daily, ratePaise: 60_001, halfDayFactorBp: 6000, status: 'HALF_DAY', minutes: null }).wagePaise).toBe(36_001); // 36000.6
  });

  it('hourly: hours × rate; absent = 0; hours required when working', () => {
    expect(computeWage({ ...hourly, status: 'PRESENT', minutes: hoursToMinutes(7.5) })).toEqual({ minutes: 450, wagePaise: 67_500 });
    expect(computeWage({ ...hourly, status: 'HALF_DAY', minutes: hoursToMinutes(4) })).toEqual({ minutes: 240, wagePaise: 36_000 });
    expect(computeWage({ ...hourly, status: 'ABSENT', minutes: null })).toEqual({ minutes: null, wagePaise: 0 });
    expect(() => computeWage({ ...hourly, status: 'PRESENT', minutes: null })).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });

  it('refuses hours where they make no sense', () => {
    expect(() => computeWage({ ...daily, status: 'PRESENT', minutes: 480 })).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(() => computeWage({ ...hourly, status: 'ABSENT', minutes: 60 })).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
    expect(() => computeWage({ ...hourly, status: 'PRESENT', minutes: 24 * 60 + 1 })).toThrow(expect.objectContaining({ code: 'VALIDATION_ERROR' }));
  });
});
