import { ATTENDANCE_STATUS } from '../constants/workforce.js';
import { SHIFTS, shiftOfHour } from '../constants/shifts.js';
import { Attendance } from '../models/Attendance.js';
import { Dispatch, DISPATCH_STATUS } from '../models/Fulfilment.js';
import { Machine } from '../models/Machine.js';
import { MachineEvent } from '../models/MachineEvent.js';
import { QcInspection } from '../models/QcInspection.js';
import { Roll } from '../models/Roll.js';
import { AppError } from '../utils/AppError.js';
import { endOfIndiaDayExclusive, startOfIndiaDay, todayInIndia } from '../utils/dates.js';
import { cmToMetres } from '../utils/units.js';

/*
 * Production reports from recorded rolls and inspections (FLOOR_MANAGER, QC_INSPECTOR, ADMIN):
 * how much every machine produced (today and in a period), output per shift and per day, and where
 * defects come from (by machine and defect type). Shifts are worked out from the time each roll was
 * recorded (constants/shifts.js); nothing is estimated.
 */

const IST_MS = 330 * 60_000;
const istDate = (d) => new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 10);
const istHour = (d) => new Date(new Date(d).getTime() + IST_MS).getUTCHours();
const m = (cm) => cmToMetres(cm);

export async function productionReport({ from, to }) {
  if (from > to) throw new AppError('VALIDATION_ERROR', 'Request validation failed', { details: [{ location: 'query', path: 'to', message: 'must be on or after from' }] });
  const range = { $gte: startOfIndiaDay(from), $lt: endOfIndiaDayExclusive(to) };
  const today = todayInIndia();
  const todayRange = { $gte: startOfIndiaDay(today), $lt: endOfIndiaDayExclusive(today) };

  const [machines, rolls, todayRolls, inspections, downtime] = await Promise.all([
    Machine.find({}, { code: 1, name: 1, type: 1, status: 1, isActive: 1 }).sort({ code: 1 }).lean(),
    Roll.find({ createdAt: range }, { machineId: 1, lengthCm: 1, status: 1, createdAt: 1 }).lean(),
    Roll.aggregate([{ $match: { createdAt: todayRange } }, { $group: { _id: '$machineId', cm: { $sum: '$lengthCm' }, rolls: { $sum: 1 } } }]),
    QcInspection.find({ inspectedAt: range }, { machineId: 1, result: 1, defects: 1 }).lean(),
    MachineEvent.find({ type: 'MAINTENANCE_ENDED', occurredAt: range, downtimeMinutes: { $ne: null } }, { machineId: 1, downtimeMinutes: 1 }).lean(),
  ]);
  const todayBy = new Map(todayRolls.map((r) => [String(r._id), r]));

  const byMachine = machines.map((mc) => {
    const own = rolls.filter((r) => String(r.machineId) === String(mc._id));
    const sum = (filter) => own.filter(filter).reduce((s, r) => s + r.lengthCm, 0);
    const checks = inspections.filter((i) => String(i.machineId) === String(mc._id));
    const failed = checks.filter((i) => i.result !== 'PASS').length;
    return {
      machineId: String(mc._id), code: mc.code, name: mc.name, type: mc.type, status: mc.isActive ? mc.status : 'OUT_OF_SERVICE',
      todayMetres: m(todayBy.get(String(mc._id))?.cm ?? 0), todayRolls: todayBy.get(String(mc._id))?.rolls ?? 0,
      rolls: own.length, producedMetres: m(sum(() => true)), rejectedMetres: m(sum((r) => r.status === 'REJECTED')),
      inspections: checks.length, failedInspections: failed, defectRatePercent: checks.length ? Math.round((failed / checks.length) * 1000) / 10 : null,
      maintenanceDowntimeMinutes: downtime.filter((d) => String(d.machineId) === String(mc._id)).reduce((s, d) => s + d.downtimeMinutes, 0),
    };
  });

  const byShift = SHIFTS.map((shift) => {
    const own = rolls.filter((r) => shiftOfHour(istHour(r.createdAt)) === shift.key);
    return { shift: shift.key, label: shift.label, hours: shift.hours, rolls: own.length, producedMetres: m(own.reduce((s, r) => s + r.lengthCm, 0)) };
  });

  const days = new Map();
  for (const r of rolls) {
    const d = istDate(r.createdAt);
    const row = days.get(d) ?? { date: d, rolls: 0, cm: 0 };
    row.rolls += 1;
    row.cm += r.lengthCm;
    days.set(d, row);
  }
  const byDay = [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ date: d.date, rolls: d.rolls, producedMetres: m(d.cm) }));

  const defectCounts = new Map();
  for (const i of inspections) for (const d of i.defects ?? []) defectCounts.set(d.type, (defectCounts.get(d.type) ?? 0) + 1);
  const byDefectType = [...defectCounts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count);

  return {
    period: { from, to },
    totals: { rolls: rolls.length, producedMetres: m(rolls.reduce((s, r) => s + r.lengthCm, 0)), inspections: inspections.length, failedInspections: inspections.filter((i) => i.result !== 'PASS').length },
    byMachine,
    byShift,
    byDay,
    byDefectType,
  };
}

/** What happened at the mill today (dashboard): output, quality, dispatch, attendance, problems. */
export async function todaySummary() {
  const today = todayInIndia();
  const range = { $gte: startOfIndiaDay(today), $lt: endOfIndiaDayExclusive(today) };
  const [rolls, inspections, dispatched, attendance, problems, runningMachines] = await Promise.all([
    Roll.aggregate([{ $match: { createdAt: range } }, { $group: { _id: null, cm: { $sum: '$lengthCm' }, count: { $sum: 1 } } }]),
    QcInspection.aggregate([{ $match: { inspectedAt: range } }, { $group: { _id: '$result', count: { $sum: 1 } } }]),
    Dispatch.aggregate([{ $match: { status: DISPATCH_STATUS.CONFIRMED, confirmedAt: range } }, { $group: { _id: null, cm: { $sum: '$totalLengthCm' }, count: { $sum: 1 } } }]),
    Attendance.aggregate([{ $match: { date: today } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    MachineEvent.countDocuments({ type: 'PROBLEM_REPORTED', occurredAt: range }),
    Machine.countDocuments({ isActive: true, status: 'RUNNING' }),
  ]);
  const qc = Object.fromEntries(inspections.map((r) => [r._id, r.count]));
  const att = Object.fromEntries(attendance.map((r) => [r._id, r.count]));
  return {
    date: today,
    producedMetres: m(rolls[0]?.cm ?? 0),
    rolls: rolls[0]?.count ?? 0,
    inspections: { pass: qc.PASS ?? 0, rework: qc.REWORK ?? 0, reject: qc.REJECT ?? 0 },
    dispatchedMetres: m(dispatched[0]?.cm ?? 0),
    dispatches: dispatched[0]?.count ?? 0,
    attendance: { present: att[ATTENDANCE_STATUS.PRESENT] ?? 0, halfDay: att[ATTENDANCE_STATUS.HALF_DAY] ?? 0, absent: att[ATTENDANCE_STATUS.ABSENT] ?? 0 },
    problemsReported: problems,
    machinesRunning: runningMachines,
  };
}
