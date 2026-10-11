import assert from 'node:assert/strict';
import { test } from 'node:test';
import { attendanceEntry, canCorrect, daysBefore, todayInIndia } from './attendance.js';

const daily = { id: 'w1', wageBasis: 'DAILY' };
const hourly = { id: 'w2', wageBasis: 'HOURLY' };

test('a daily-rated worker is marked without hours; an hourly one needs hours when working', () => {
  assert.deepEqual(attendanceEntry({ worker: daily, date: '2026-10-11', status: 'HALF_DAY', hours: '8' }).body, { workerId: 'w1', date: '2026-10-11', status: 'HALF_DAY' });
  assert.deepEqual(attendanceEntry({ worker: hourly, date: '2026-10-11', status: 'PRESENT', hours: '7.5' }).body, { workerId: 'w2', date: '2026-10-11', status: 'PRESENT', hours: 7.5 });
  assert.ok(attendanceEntry({ worker: hourly, date: '2026-10-11', status: 'PRESENT', hours: '' }).error);
  assert.ok(attendanceEntry({ worker: hourly, date: '2026-10-11', status: 'PRESENT', hours: '25' }).error);
  assert.ok(attendanceEntry({ worker: hourly, date: '2026-10-11', status: 'PRESENT', hours: '1.234' }).error);
  assert.deepEqual(attendanceEntry({ worker: hourly, date: '2026-10-11', status: 'ABSENT', hours: '8' }).body, { workerId: 'w2', date: '2026-10-11', status: 'ABSENT' });
  assert.ok(attendanceEntry({ worker: daily, date: '2026-10-11' }).error);
});

test('the floor manager corrects the last 7 days; the admin any day; others never', () => {
  assert.equal(daysBefore('2026-10-11', 6), '2026-10-05');
  assert.equal(canCorrect('FLOOR_MANAGER', '2026-10-05', '2026-10-11'), true);
  assert.equal(canCorrect('FLOOR_MANAGER', '2026-10-04', '2026-10-11'), false);
  assert.equal(canCorrect('ADMIN', '2020-01-01', '2026-10-11'), true);
  assert.equal(canCorrect('QC_INSPECTOR', '2026-10-11', '2026-10-11'), false);
});

test('today is the Indian calendar day', () => {
  assert.equal(todayInIndia(new Date('2026-10-10T19:00:00Z')), '2026-10-11'); // 00:30 IST
});
