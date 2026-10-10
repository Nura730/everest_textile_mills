import { containsInsensitive, searchAcross } from '../../src/utils/search.js';
import { endOfIndiaDayExclusive, startOfIndiaDay } from '../../src/utils/dates.js';

describe('containsInsensitive', () => {
  it('matches anywhere, ignoring case', () => {
    expect(containsInsensitive('surat').test('BUY-SRT Surat Fabrics')).toBe(true);
  });

  it('escapes regex characters so they are searched literally', () => {
    const pattern = containsInsensitive('a.*b(');
    expect(pattern.test('a.*b(')).toBe(true);
    expect(pattern.test('axxxb(')).toBe(false);
  });
});

describe('searchAcross', () => {
  it('builds an $or over the fields, or nothing without text', () => {
    expect(searchAcross(['code', 'name'], undefined)).toEqual({});
    expect(searchAcross(['code', 'name'], 'x').$or).toHaveLength(2);
  });
});

describe('Indian calendar day bounds', () => {
  it('starts at 18:30 UTC the previous day and ends 24 h later', () => {
    expect(startOfIndiaDay('2026-10-10').toISOString()).toBe('2026-10-09T18:30:00.000Z');
    expect(endOfIndiaDayExclusive('2026-10-10').toISOString()).toBe('2026-10-10T18:30:00.000Z');
  });
});
