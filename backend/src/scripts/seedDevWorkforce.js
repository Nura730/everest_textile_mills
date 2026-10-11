import { createHash } from 'node:crypto';
import { ROLES } from '../constants/roles.js';
import { Attendance } from '../models/Attendance.js';
import { User } from '../models/User.js';
import { Worker } from '../models/Worker.js';
import { correctAttendance, createWorker, recordAttendance, updateWorker } from '../services/workforce.service.js';
import { addDaysToDateString, todayInIndia } from '../utils/dates.js';

/*
 * Demo workers and about four weeks of attendance for local development and the project review.
 * Everything goes through the REAL services: the server computes every wage, every entry is audited.
 * Re-running creates nothing twice (unique worker codes, one entry per worker per day, fixed
 * idempotency keys). The admin adds the workers; the floor manager keeps the register.
 */

const WORKERS = [
  { code: 'WK-001', name: 'Murugan S', department: 'WEAVING', wageBasis: 'DAILY', ratePaise: 65_000 },
  { code: 'WK-002', name: 'Lakshmi R', department: 'WEAVING', wageBasis: 'DAILY', ratePaise: 65_000 },
  { code: 'WK-003', name: 'Senthil K', department: 'WEAVING', wageBasis: 'DAILY', ratePaise: 62_000 },
  { code: 'WK-004', name: 'Kavitha M', department: 'SPINNING', wageBasis: 'DAILY', ratePaise: 60_000 },
  { code: 'WK-005', name: 'Ramesh P', department: 'SPINNING', wageBasis: 'DAILY', ratePaise: 60_000 },
  { code: 'WK-006', name: 'Anitha V', department: 'DYEING', wageBasis: 'HOURLY', ratePaise: 8_500 },
  { code: 'WK-007', name: 'Karthik B', department: 'DYEING', wageBasis: 'HOURLY', ratePaise: 8_500 },
  { code: 'WK-008', name: 'Priya D', department: 'FINISHING', wageBasis: 'DAILY', ratePaise: 58_000 },
  { code: 'WK-009', name: 'Suresh A', department: 'QUALITY', wageBasis: 'DAILY', ratePaise: 70_000 },
  { code: 'WK-010', name: 'Mani T', department: 'STORE', wageBasis: 'DAILY', ratePaise: 55_000 },
  { code: 'WK-011', name: 'Vijay N', department: 'MAINTENANCE', wageBasis: 'DAILY', ratePaise: 80_000 },
  { code: 'WK-012', name: 'Selvi G', department: 'GENERAL', wageBasis: 'HOURLY', ratePaise: 7_000 },
];
// Left the mill 3 weeks ago: has history, no longer in the daily register.
const FORMER = { code: 'WK-013', name: 'Arjun P', department: 'WEAVING', wageBasis: 'DAILY', ratePaise: 60_000, lastDay: 22 };

const DAYS = 28;

const actorOf = (user) => ({ id: String(user._id), role: user.role, buyerId: null });
const ctx = (user, key) => ({ actor: actorOf(user), idempotencyKey: key, requestId: 'seed-dev', source: 'ONLINE' });

/** A stable 0-99 number per worker and day, so the pattern is the same on every run. */
const roll = (code, date) => createHash('sha256').update(`${code}:${date}`).digest()[0] % 100;

/** Sunday is the mill's weekly off. */
const isSunday = (date) => new Date(`${date}T00:00:00.000Z`).getUTCDay() === 0;

function entryFor(worker, date) {
  const r = roll(worker.code, date);
  const status = r < 5 ? 'ABSENT' : r < 13 ? 'HALF_DAY' : 'PRESENT';
  if (worker.wageBasis !== 'HOURLY' || status === 'ABSENT') return { status };
  // hourly: a normal 8-hour shift, 4 hours for a half day, sometimes overtime
  const hours = status === 'HALF_DAY' ? 4 : r > 90 ? 9.5 : 8;
  return { status, hours };
}

async function once(action) {
  try {
    const result = await action();
    return result?.replayed ? 'exists' : 'created';
  } catch (err) {
    if (['IDEMPOTENCY_KEY_REUSED', 'DUPLICATE_RESOURCE'].includes(err.code) || err.code === 11000) return 'exists';
    throw err;
  }
}

export async function seedDevWorkforce({ nodeEnv }) {
  if (nodeEnv === 'production') throw new Error('seed:dev refuses to run with NODE_ENV=production.');
  const admin = await User.findOne({ role: ROLES.ADMIN, isActive: true }).sort({ createdAt: 1 }).lean();
  const floor = (await User.findOne({ role: ROLES.FLOOR_MANAGER, isActive: true }).sort({ createdAt: 1 }).lean()) ?? admin;
  if (!admin) throw new Error('No active admin: run the user seed first.');

  const report = { workers: { created: 0, exists: 0 }, attendance: { created: 0, exists: 0 }, corrections: 0 };
  const today = todayInIndia();

  for (const spec of [...WORKERS, FORMER]) {
    const { lastDay, ...input } = spec;
    report.workers[await once(() => createWorker(input, ctx(admin, null)))] += 1;
  }
  const workers = await Worker.find({ code: { $in: [...WORKERS, FORMER].map((w) => w.code) } }).lean();
  const byCode = new Map(workers.map((w) => [w.code, w]));

  // The former worker's history must be recorded while still active; then they leave.
  const former = byCode.get(FORMER.code);
  const formerDays = [];
  for (let back = DAYS; back >= FORMER.lastDay; back -= 1) formerDays.push(addDaysToDateString(today, -back));

  const record = async (worker, date) => {
    const { status, hours } = entryFor(worker, date);
    const body = { workerId: String(worker._id), date, status, ...(hours !== undefined ? { hours } : {}) };
    report.attendance[await once(() => recordAttendance(body, ctx(floor, `seed-att-${worker.code}-${date}`)))] += 1;
  };

  if (former.isActive) {
    for (const date of formerDays.filter((d) => !isSunday(d))) await record(former, date);
    await updateWorker(former._id, { isActive: false, expectedUpdatedAt: former.updatedAt.toISOString() }, ctx(admin, null));
  }

  for (let back = DAYS; back >= 0; back -= 1) {
    const date = addDaysToDateString(today, -back);
    if (isSunday(date)) continue;
    for (const spec of WORKERS) {
      // today's register is being filled in: the last three workers are not marked yet
      if (back === 0 && WORKERS.indexOf(spec) >= WORKERS.length - 3) continue;
      await record(byCode.get(spec.code), date);
    }
  }

  // Two corrections the floor manager made (within the 7-day window), each with a reason.
  const fixes = [
    { code: 'WK-002', back: 2, change: { status: 'HALF_DAY' }, reason: 'Left at lunch for a family function; marked present by mistake' },
    { code: 'WK-006', back: 3, change: { status: 'PRESENT', hours: 9.5 }, reason: 'Stayed back to finish the dye batch (overtime)' },
  ];
  for (const fix of fixes) {
    let date = addDaysToDateString(today, -fix.back);
    if (isSunday(date)) date = addDaysToDateString(date, -1);
    const entry = await Attendance.findOne({ workerId: byCode.get(fix.code)._id, date }).lean();
    if (!entry || entry.corrections.length > 0) continue;
    if (entry.status === fix.change.status && (fix.change.hours === undefined || entry.minutes === fix.change.hours * 60)) continue;
    await correctAttendance(entry._id, { ...fix.change, reason: fix.reason, expectedUpdatedAt: entry.updatedAt.toISOString() }, ctx(floor, null));
    report.corrections += 1;
  }

  return [
    { item: 'Workers', created: report.workers.created, existing: report.workers.exists },
    { item: `Attendance entries (last ${DAYS} days, Sundays off)`, created: report.attendance.created, existing: report.attendance.exists },
    { item: 'Corrections with a reason', created: report.corrections, existing: '' },
  ];
}
