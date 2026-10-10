import { daysBetween, evaluateFeasibility } from '../../src/services/feasibility.service.js';

// The instruction.md example: 5,000 m Navy Cotton needs 850 kg of yarn.
const base = {
  requiredYarnGrams: 850_000,
  material: 'COTTON',
  colour: 'Navy',
  stock: { totalGrams: 1_200_000, reservedGrams: 0 },
  committedGrams: 0,
  requiredBy: '2026-10-25',
  today: '2026-10-10',
  now: new Date('2026-10-10T06:00:00Z'),
};

const check = (result, code) => result.checks.find((entry) => entry.code === code);

describe('evaluateFeasibility', () => {
  it('is FEASIBLE when free yarn covers the order and the deadline is ahead', () => {
    const result = evaluateFeasibility(base);

    expect(result.status).toBe('FEASIBLE');
    expect(check(result, 'MATERIAL')).toMatchObject({ result: 'PASS' });
    expect(check(result, 'MATERIAL').message).toBe(
      'Needs 850 kg of COTTON Navy yarn; 1,200 kg is free (1,200 kg available in stock − 0 kg promised to other confirmed orders).',
    );
    expect(check(result, 'DEADLINE')).toMatchObject({ result: 'PASS', message: '15 days left until the required-by date (2026-10-25).' });
    expect(result.inputs).toEqual({
      requiredYarnGrams: 850_000,
      stockTotalGrams: 1_200_000,
      stockReservedGrams: 0,
      committedGrams: 0,
      freeGrams: 1_200_000,
      shortfallGrams: 0,
      requiredBy: '2026-10-25',
      assessedOn: '2026-10-10',
      daysToDeadline: 15,
    });
    expect(result.computedAt).toEqual(base.now);
  });

  it('passes with exactly enough yarn (no hidden safety margin)', () => {
    expect(evaluateFeasibility({ ...base, stock: { totalGrams: 850_000, reservedGrams: 0 } }).status).toBe('FEASIBLE');
  });

  it('fails one gram short and says by how much', () => {
    const result = evaluateFeasibility({ ...base, stock: { totalGrams: 849_999, reservedGrams: 0 } });

    expect(result.status).toBe('NOT_FEASIBLE');
    expect(result.inputs.shortfallGrams).toBe(1);
    expect(check(result, 'MATERIAL').message).toMatch(/^Short by 0\.001 kg: needs 850 kg/);
  });

  it('does not count reserved yarn as available', () => {
    const result = evaluateFeasibility({ ...base, stock: { totalGrams: 1_200_000, reservedGrams: 500_000 } });

    expect(result.status).toBe('NOT_FEASIBLE');
    expect(result.inputs).toMatchObject({ freeGrams: 700_000, shortfallGrams: 150_000 });
  });

  it('does not count yarn already promised to other confirmed orders', () => {
    const result = evaluateFeasibility({ ...base, committedGrams: 400_000 });

    expect(result.status).toBe('NOT_FEASIBLE');
    expect(result.inputs).toMatchObject({ freeGrams: 800_000, shortfallGrams: 50_000 });
    expect(check(result, 'MATERIAL').message).toContain('400 kg promised to other confirmed orders');
  });

  it('never reports negative free stock when promises exceed what is in stock', () => {
    const result = evaluateFeasibility({ ...base, committedGrams: 2_000_000 });
    expect(result.inputs).toMatchObject({ freeGrams: 0, shortfallGrams: 850_000 });
  });

  it.each([
    ['today', '2026-10-10', 'is today'],
    ['in the past', '2026-10-01', 'has passed'],
  ])('fails the deadline check when the required-by date is %s', (_label, requiredBy, phrase) => {
    const result = evaluateFeasibility({ ...base, requiredBy });

    expect(result.status).toBe('NOT_FEASIBLE');
    expect(check(result, 'DEADLINE').result).toBe('FAIL');
    expect(check(result, 'DEADLINE').message).toContain(phrase);
  });

  it('uses the singular for one day left', () => {
    expect(check(evaluateFeasibility({ ...base, requiredBy: '2026-10-11' }), 'DEADLINE').message).toBe(
      '1 day left until the required-by date (2026-10-11).',
    );
  });

  it('reports machine capacity as not assessed, and that never decides the verdict', () => {
    const result = evaluateFeasibility(base);
    expect(check(result, 'MACHINE_CAPACITY').result).toBe('NOT_ASSESSED');
    expect(result.status).toBe('FEASIBLE');
  });

  it('lists every failing reason, not just the first', () => {
    const result = evaluateFeasibility({ ...base, stock: { totalGrams: 0, reservedGrams: 0 }, requiredBy: '2026-10-01' });
    expect(result.checks.filter((entry) => entry.result === 'FAIL').map((entry) => entry.code)).toEqual(['MATERIAL', 'DEADLINE']);
  });
});

describe('daysBetween', () => {
  it('counts calendar days, including across a month end', () => {
    expect(daysBetween('2026-10-30', '2026-11-02')).toBe(3);
    expect(daysBetween('2026-10-10', '2026-10-10')).toBe(0);
    expect(daysBetween('2026-10-10', '2026-10-09')).toBe(-1);
  });
});
