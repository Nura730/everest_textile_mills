import { Machine } from '../models/Machine.js';
import { MachineEvent } from '../models/MachineEvent.js';
import { searchAcross } from '../utils/search.js';
import { endOfIndiaDayExclusive, startOfIndiaDay } from '../utils/dates.js';

// ── Machines ────────────────────────────────────────────────────────────────────
export async function insertMachine(data, session) {
  const [machine] = await Machine.create([data], { session });
  return machine.toObject();
}

export function findMachineById(id, { session } = {}) {
  return Machine.findById(id).session(session ?? null).lean();
}

export async function findMachinesPage({ type, status, q, isActive }, { page, limit }) {
  const filter = { ...searchAcross(['code', 'name', 'location'], q) };
  if (type) filter.type = type;
  if (status) filter.status = status;
  if (isActive !== undefined) filter.isActive = isActive;
  const [machines, total] = await Promise.all([
    Machine.find(filter).sort({ type: 1, code: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    Machine.countDocuments(filter),
  ]);
  return { machines, total };
}

/** $set only if the machine still has the updatedAt that was read (edit forms). */
export function updateMachineIfUnchanged(id, updatedAt, set, session) {
  return Machine.findOneAndUpdate({ _id: id, updatedAt }, { $set: set }, { returnDocument: 'after', session, lean: true });
}

/**
 * Status change only if the machine is still active and in `fromStatus` at the moment of the write.
 * Returns the updated machine, or null when someone else changed it first.
 */
export function transitionMachineGuarded(id, fromStatus, set, session) {
  return Machine.findOneAndUpdate(
    { _id: id, status: fromStatus, isActive: true },
    { $set: { ...set, statusChangedAt: new Date() } },
    { returnDocument: 'after', session, lean: true },
  );
}

// ── Events ──────────────────────────────────────────────────────────────────────
export async function appendMachineEvent(data, session) {
  const [event] = await MachineEvent.create([data], { session });
  return event.toObject();
}

export function findMachineEventById(id, { session } = {}) {
  return MachineEvent.findById(id).session(session ?? null).lean();
}

export async function findMachineEventsPage(machineId, { type, from, to }, { page, limit }) {
  const filter = { machineId };
  if (type) filter.type = type;
  if (from || to) {
    filter.occurredAt = {};
    if (from) filter.occurredAt.$gte = startOfIndiaDay(from);
    if (to) filter.occurredAt.$lt = endOfIndiaDayExclusive(to);
  }
  const [events, total] = await Promise.all([
    MachineEvent.find(filter).sort({ occurredAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    MachineEvent.countDocuments(filter),
  ]);
  return { events, total };
}

/** Problems reported on the machines and not yet resolved, oldest first. */
export async function findOpenProblems(machineIds, { session } = {}) {
  const reported = await MachineEvent.find({ machineId: { $in: machineIds }, type: 'PROBLEM_REPORTED' })
    .sort({ occurredAt: 1 })
    .session(session ?? null)
    .lean();
  if (reported.length === 0) return [];
  const resolved = await MachineEvent.find({ resolvesEventId: { $in: reported.map((event) => event._id) } }, { resolvesEventId: 1 })
    .session(session ?? null)
    .lean();
  const resolvedIds = new Set(resolved.map((event) => String(event.resolvesEventId)));
  return reported.filter((event) => !resolvedIds.has(String(event._id)));
}

/** Critical problems of one machine with their resolution (if any): the downtime record. */
export async function findCriticalProblemsWithResolution(machineId) {
  const reported = await MachineEvent.find({ machineId, type: 'PROBLEM_REPORTED', 'problem.severity': 'CRITICAL' }).sort({ occurredAt: -1 }).lean();
  const resolutions = await MachineEvent.find({ resolvesEventId: { $in: reported.map((event) => event._id) } }).lean();
  const byReported = new Map(resolutions.map((event) => [String(event.resolvesEventId), event]));
  return reported.map((event) => ({ reported: event, resolved: byReported.get(String(event._id)) ?? null }));
}
