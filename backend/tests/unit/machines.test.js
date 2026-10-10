import { CANNOT_RUN_STATUSES, MACHINE_STATUS, statusAfterRepair } from '../../src/constants/machines.js';
import { downtimeMinutes } from '../../src/services/machine.service.js';

describe('statusAfterRepair', () => {
  it.each([
    [MACHINE_STATUS.AVAILABLE, MACHINE_STATUS.AVAILABLE],
    [MACHINE_STATUS.MAINTENANCE, MACHINE_STATUS.AVAILABLE],
    [MACHINE_STATUS.ASSIGNED, MACHINE_STATUS.ASSIGNED],
    [MACHINE_STATUS.RUNNING, MACHINE_STATUS.PAUSED], // a stopped run is resumed by a person, not automatically
    [MACHINE_STATUS.PAUSED, MACHINE_STATUS.PAUSED],
    [null, MACHINE_STATUS.AVAILABLE],
  ])('a machine that was %s comes back %s', (before, after) => {
    expect(statusAfterRepair(before)).toBe(after);
  });
});

describe('machine state rules', () => {
  it('never lets a DOWN or MAINTENANCE machine run (the spec example)', () => {
    expect(CANNOT_RUN_STATUSES).toEqual([MACHINE_STATUS.DOWN, MACHINE_STATUS.MAINTENANCE]);
  });

  it('has no IDLE state (decision D4)', () => {
    expect(Object.values(MACHINE_STATUS)).not.toContain('IDLE');
  });
});

describe('downtimeMinutes', () => {
  const at = (iso) => new Date(iso);
  it('adds reported → resolved durations and counts an open problem up to now', () => {
    const problems = [
      { reported: { occurredAt: at('2026-10-10T08:00:00Z') }, resolved: { occurredAt: at('2026-10-10T09:30:00Z') } },
      { reported: { occurredAt: at('2026-10-10T11:00:00Z') }, resolved: null },
    ];
    expect(downtimeMinutes(problems, at('2026-10-10T11:20:00Z'))).toBe(90 + 20);
  });

  it('is zero without critical problems', () => {
    expect(downtimeMinutes([])).toBe(0);
  });
});
