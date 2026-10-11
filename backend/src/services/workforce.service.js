import { recordAudit } from '../audit/recordAudit.js';
import { getConfig } from '../config/env.js';
import { ROLES } from '../constants/roles.js';
import { ATTENDANCE_STATUS, DEPARTMENTS, FLOOR_CORRECTION_WINDOW_DAYS } from '../constants/workforce.js';
import { Attendance, toPublicAttendance } from '../models/Attendance.js';
import { Worker, toPublicWorker } from '../models/Worker.js';
import { AppError } from '../utils/AppError.js';
import { addDaysToDateString, todayInIndia } from '../utils/dates.js';
import { diffFields, isStale, staleEditConflict } from '../utils/edits.js';
import { runInTransaction } from '../utils/transaction.js';
import { executeIdempotent } from './idempotency.service.js';
import { computeWage, hoursToMinutes } from './wage.service.js';

/*
 * Workers, the attendance register and wages.
 *
 *   ADMIN          manages workers and their wage terms; records and corrects any attendance; sees wages
 *   FLOOR_MANAGER  records attendance; corrects entries of the last FLOOR_CORRECTION_WINDOW_DAYS days;
 *                  sees the register without money (wages are the admin's)
 *   QC_INSPECTOR   reads the register (no changes, no money)
 *   STORE_KEEPER, BUYER  no access
 *
 * Wages are computed here from the worker's terms (snapshotted on the entry) and summarised per worker
 * and department. Labour cost from this register is a factory expense reported on its own: it is not
 * spread over orders (order costing keeps its own machine-hour labour estimate; see costing.service).
 */

const canSeeWages = (actor) => actor.role === ROLES.ADMIN;
const notFound = (what) => new AppError('NOT_FOUND', `${what} not found`);

// ── Workers ─────────────────────────────────────────────────────────────────────

export async function listWorkers({ q, department, isActive, page, limit }, actor) {
  const filter = {};
  if (department) filter.department = department;
  if (isActive !== undefined) filter.isActive = isActive;
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ code: rx }, { name: rx }];
  }
  const [workers, total] = await Promise.all([
    Worker.find(filter).sort({ isActive: -1, department: 1, name: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Worker.countDocuments(filter),
  ]);
  return { workers: workers.map((w) => toPublicWorker(w, { includeWages: canSeeWages(actor) })), meta: { page, limit, total } };
}

export async function getWorker(id, actor) {
  const worker = await Worker.findById(id).lean();
  if (!worker) throw notFound('Worker');
  return { worker: toPublicWorker(worker, { includeWages: canSeeWages(actor) }) };
}

export function createWorker(input, context) {
  return runInTransaction(async (session) => {
    let worker;
    try {
      [worker] = await Worker.create([{ ...input, createdBy: context.actor.id }], { session });
    } catch (err) {
      if (err?.code === 11000) throw new AppError('DUPLICATE_RESOURCE', `Worker code ${input.code} is already in use`, { details: { fields: ['code'] } });
      throw err;
    }
    await recordAudit({ action: 'WORKER_CREATED', entityType: 'Worker', entityId: worker._id, after: { code: worker.code, name: worker.name, department: worker.department, wageBasis: worker.wageBasis, ratePaise: worker.ratePaise } }, context, session);
    return { worker: toPublicWorker(worker.toObject(), { includeWages: true }) };
  });
}

/** Edit a worker (ADMIN). New wage terms apply to attendance recorded from now on, never to past entries. */
export function updateWorker(id, { expectedUpdatedAt, ...changes }, context) {
  return runInTransaction(async (session) => {
    const current = await Worker.findById(id).session(session).lean();
    if (!current) throw notFound('Worker');
    const diff = diffFields(current, changes);
    if (!diff) return { worker: toPublicWorker(current, { includeWages: true }) };
    if (isStale(current, expectedUpdatedAt)) throw staleEditConflict('worker');
    const updated = await Worker.findOneAndUpdate({ _id: current._id, updatedAt: current.updatedAt }, { $set: diff.after }, { returnDocument: 'after', session, lean: true });
    if (!updated) throw staleEditConflict('worker');
    await recordAudit({ action: 'WORKER_UPDATED', entityType: 'Worker', entityId: current._id, ...diff }, context, session);
    return { worker: toPublicWorker(updated, { includeWages: true }) };
  });
}

// ── Attendance ──────────────────────────────────────────────────────────────────

function checkDate(date) {
  if (date > todayInIndia()) {
    throw new AppError('VALIDATION_ERROR', 'Request validation failed', { details: [{ location: 'body', path: 'date', message: 'cannot be in the future' }] });
  }
}

/**
 * Record one worker's attendance for one day (FLOOR_MANAGER, ADMIN; also replayed from the offline
 * queue). One entry per worker and day: a second one is refused with the existing entry's id (correct
 * it instead). Retried requests with the same Idempotency-Key replay the first result.
 */
export function recordAttendance({ workerId, date, status, hours, note }, context) {
  return executeIdempotent({ context, operation: 'ATTENDANCE_RECORD', request: { workerId, date, status, hours: hours ?? null, note: note ?? null } }, async (session) => {
    checkDate(date);
    const worker = await Worker.findById(workerId).session(session).lean();
    if (!worker) throw notFound('Worker');
    if (!worker.isActive) throw new AppError('CONFLICT', `${worker.code} ${worker.name} is no longer active`, { details: { reason: 'WORKER_INACTIVE' } });
    const existing = await Attendance.findOne({ workerId: worker._id, date }, { _id: 1 }).session(session).lean();
    const duplicate = (id) =>
      new AppError('DUPLICATE_RESOURCE', `Attendance for ${worker.code} on ${date} is already recorded. Correct that entry instead.`, { details: { fields: ['workerId', 'date'], attendanceId: id ? String(id) : null } });
    if (existing) throw duplicate(existing._id);
    const halfDayFactorBp = getConfig().halfDayWageFactorBp;
    const { minutes, wagePaise } = computeWage({ wageBasis: worker.wageBasis, ratePaise: worker.ratePaise, status, minutes: hoursToMinutes(hours), halfDayFactorBp });
    let entry;
    try {
      [entry] = await Attendance.create(
        [
          {
            workerId: worker._id, workerCode: worker.code, workerName: worker.name, department: worker.department, date, status, minutes,
            wageBasis: worker.wageBasis, ratePaise: worker.ratePaise, halfDayFactorBp, wagePaise, note: note ?? null,
            recordedBy: context.actor.id, recordedByRole: context.actor.role, source: context.source === 'OFFLINE' ? 'OFFLINE' : 'ONLINE',
          },
        ],
        { session },
      );
    } catch (err) {
      if (err?.code === 11000) throw duplicate(null);
      throw err;
    }
    await recordAudit(
      { action: 'ATTENDANCE_RECORDED', entityType: 'Attendance', entityId: entry._id, after: { workerCode: worker.code, date, status, minutes, wagePaise } },
      context,
      session,
    );
    return { statusCode: 201, body: { attendance: toPublicAttendance(entry.toObject(), { includeWages: canSeeWages(context.actor) }) } };
  });
}

/**
 * Correct an entry (status and/or hours) with a reason. The admin corrects any day; the floor manager
 * only the last FLOOR_CORRECTION_WINDOW_DAYS days. The wage is recomputed with the terms snapshotted on
 * the entry; the before/after, reason and author are kept on the entry and in the audit log.
 */
export function correctAttendance(id, { status, hours, reason, expectedUpdatedAt }, context) {
  return runInTransaction(async (session) => {
    const current = await Attendance.findById(id).session(session).lean();
    if (!current) throw notFound('Attendance entry');
    if (context.actor.role !== ROLES.ADMIN) {
      const oldest = addDaysToDateString(todayInIndia(), -(FLOOR_CORRECTION_WINDOW_DAYS - 1));
      if (current.date < oldest) {
        throw new AppError('FORBIDDEN', `Entries older than ${FLOOR_CORRECTION_WINDOW_DAYS} days are corrected by the admin (this one is ${current.date})`, { details: { reason: 'CORRECTION_WINDOW_PASSED', oldestDate: oldest } });
      }
    }
    if (isStale(current, expectedUpdatedAt)) throw staleEditConflict('attendance entry');
    const nextStatus = status ?? current.status;
    const requestedMinutes = hours === undefined ? (nextStatus === ATTENDANCE_STATUS.ABSENT ? null : current.minutes) : hoursToMinutes(hours);
    const { minutes, wagePaise } = computeWage({ wageBasis: current.wageBasis, ratePaise: current.ratePaise, status: nextStatus, minutes: requestedMinutes, halfDayFactorBp: current.halfDayFactorBp });
    if (nextStatus === current.status && (minutes ?? null) === (current.minutes ?? null)) {
      throw new AppError('VALIDATION_ERROR', 'Request validation failed', { details: [{ location: 'body', path: 'status', message: 'the correction changes nothing' }] });
    }
    const before = { status: current.status, minutes: current.minutes ?? null, wagePaise: current.wagePaise };
    const after = { status: nextStatus, minutes, wagePaise };
    const updated = await Attendance.findOneAndUpdate(
      { _id: current._id, updatedAt: current.updatedAt },
      { $set: { status: nextStatus, minutes, wagePaise }, $push: { corrections: { at: new Date(), by: context.actor.id, byRole: context.actor.role, reason, before, after } } },
      { returnDocument: 'after', session, lean: true },
    );
    if (!updated) throw staleEditConflict('attendance entry');
    await recordAudit({ action: 'ATTENDANCE_CORRECTED', entityType: 'Attendance', entityId: current._id, before, after: { ...after, reason } }, context, session);
    return { attendance: toPublicAttendance(updated, { includeWages: canSeeWages(context.actor) }) };
  });
}

function registerFilter({ date, from, to, workerId, department, status }) {
  const filter = {};
  if (date) filter.date = date;
  else if (from || to) filter.date = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  if (workerId) filter.workerId = workerId;
  if (department) filter.department = department;
  if (status) filter.status = status;
  return filter;
}

export async function listAttendance(query, actor) {
  const filter = registerFilter(query);
  const { page, limit } = query;
  const [entries, total] = await Promise.all([
    Attendance.find(filter).sort({ date: -1, department: 1, workerName: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Attendance.countDocuments(filter),
  ]);
  return { attendance: entries.map((a) => toPublicAttendance(a, { includeWages: canSeeWages(actor) })), meta: { page, limit, total } };
}

/**
 * The register for one day: every active worker (and anyone with an entry that day), with their entry
 * or null — what the floor manager fills in.
 */
export async function dayRegister({ date, department }, actor) {
  const workerFilter = { isActive: true, ...(department ? { department } : {}) };
  const [workers, entries] = await Promise.all([
    Worker.find(workerFilter).sort({ department: 1, name: 1 }).lean(),
    Attendance.find({ date, ...(department ? { department } : {}) }).lean(),
  ]);
  const byWorker = new Map(entries.map((e) => [String(e.workerId), e]));
  const includeWages = canSeeWages(actor);
  const rows = workers.map((w) => ({ worker: toPublicWorker(w, { includeWages }), attendance: byWorker.has(String(w._id)) ? toPublicAttendance(byWorker.get(String(w._id)), { includeWages }) : null }));
  // entries of workers deactivated since (kept visible)
  const listed = new Set(workers.map((w) => String(w._id)));
  for (const e of entries.filter((x) => !listed.has(String(x.workerId)))) {
    rows.push({ worker: { id: String(e.workerId), code: e.workerCode, name: e.workerName, department: e.department, wageBasis: e.wageBasis, isActive: false }, attendance: toPublicAttendance(e, { includeWages }) });
  }
  const count = (s) => entries.filter((e) => e.status === s).length;
  return {
    date,
    rows,
    totals: { workers: rows.length, recorded: entries.length, present: count(ATTENDANCE_STATUS.PRESENT), halfDay: count(ATTENDANCE_STATUS.HALF_DAY), absent: count(ATTENDANCE_STATUS.ABSENT), notRecorded: rows.filter((r) => !r.attendance).length },
  };
}

// ── Wages ───────────────────────────────────────────────────────────────────────

/**
 * Wages for a period (ADMIN), by worker and by department, from the recorded entries (server-computed
 * wages; corrections already applied). Days without an entry are not paid and are counted separately.
 */
export async function wageSummary({ from, to, department }) {
  if (from > to) throw new AppError('VALIDATION_ERROR', 'Request validation failed', { details: [{ location: 'query', path: 'to', message: 'must be on or after from' }] });
  const match = { date: { $gte: from, $lte: to }, ...(department ? { department } : {}) };
  const rows = await Attendance.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$workerId',
        workerCode: { $last: '$workerCode' },
        workerName: { $last: '$workerName' },
        department: { $last: '$department' },
        wageBasis: { $last: '$wageBasis' },
        present: { $sum: { $cond: [{ $eq: ['$status', ATTENDANCE_STATUS.PRESENT] }, 1, 0] } },
        halfDay: { $sum: { $cond: [{ $eq: ['$status', ATTENDANCE_STATUS.HALF_DAY] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', ATTENDANCE_STATUS.ABSENT] }, 1, 0] } },
        minutes: { $sum: { $ifNull: ['$minutes', 0] } },
        wagePaise: { $sum: '$wagePaise' },
      },
    },
    { $sort: { department: 1, workerName: 1 } },
  ]);
  const byWorker = rows.map((r) => ({
    workerId: String(r._id), workerCode: r.workerCode, workerName: r.workerName, department: r.department, wageBasis: r.wageBasis,
    present: r.present, halfDay: r.halfDay, absent: r.absent, hours: Math.round((r.minutes / 60) * 100) / 100, wagePaise: r.wagePaise,
  }));
  const byDepartment = DEPARTMENTS.map((d) => {
    const inDept = byWorker.filter((w) => w.department === d);
    return { department: d, workers: inDept.length, wagePaise: inDept.reduce((s, w) => s + w.wagePaise, 0), present: inDept.reduce((s, w) => s + w.present, 0), halfDay: inDept.reduce((s, w) => s + w.halfDay, 0), absent: inDept.reduce((s, w) => s + w.absent, 0) };
  }).filter((d) => d.workers > 0);
  return {
    period: { from, to },
    totalPaise: byWorker.reduce((s, w) => s + w.wagePaise, 0),
    byWorker,
    byDepartment,
    halfDayFactorBp: getConfig().halfDayWageFactorBp,
    rules: [
      'Daily-rated: present = daily rate; half day = daily rate × half-day factor; absent = 0.',
      'Hourly-rated: hours worked × hourly rate; absent = 0.',
      'Each entry is paid at the terms recorded with it (a later rate change does not rewrite it).',
      'Labour cost from this register is a factory expense, not allocated to orders.',
    ],
  };
}
