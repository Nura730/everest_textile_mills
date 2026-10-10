import { OPEN_RUN_STATUSES, RUN_STATUS } from '../constants/production.js';
import { ProductionRun } from '../models/ProductionRun.js';
import { Roll } from '../models/Roll.js';

// ── Runs ────────────────────────────────────────────────────────────────────────
export async function insertRun(data, session) {
  const [run] = await ProductionRun.create([data], { session });
  return run.toObject();
}

export function findRunById(id, { session } = {}) {
  return ProductionRun.findById(id).session(session ?? null).lean();
}

export function findRunsForOrder(orderId, { session } = {}) {
  return ProductionRun.find({ orderId }).sort({ createdAt: 1, _id: 1 }).session(session ?? null).lean();
}

export async function findRunsPage({ orderId, machineId, status }, { page, limit }) {
  const filter = {};
  if (orderId) filter.orderId = orderId;
  if (machineId) filter.machineId = machineId;
  if (status) filter.status = status;
  const [runs, total] = await Promise.all([
    ProductionRun.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ProductionRun.countDocuments(filter),
  ]);
  return { runs, total };
}

/**
 * Moves a run to `to` only if it is still in one of `from` (check and write together), recording the
 * change. Returns the updated run, or null when someone else changed it first.
 */
export function transitionRunGuarded(id, from, to, change, session, set = {}) {
  return ProductionRun.findOneAndUpdate(
    { _id: id, status: { $in: from } },
    { $set: { ...set, status: to }, $push: { statusHistory: change } },
    { returnDocument: 'after', session, lean: true },
  );
}

/** Adds a roll's length to a run, only while the run is producing (RUNNING or PAUSED). */
export function addOutputToRun(id, lengthCm, session) {
  return ProductionRun.findOneAndUpdate(
    { _id: id, status: { $in: [RUN_STATUS.RUNNING, RUN_STATUS.PAUSED] } },
    { $inc: { producedCm: lengthCm, rollCount: 1 } },
    { returnDocument: 'after', session, lean: true },
  );
}

/** How much of an order is already planned: open runs count their target, completed runs their output. */
export function plannedCmForOrder(runs) {
  return runs.reduce((sum, run) => {
    if (OPEN_RUN_STATUSES.includes(run.status)) return sum + run.targetCm;
    if (run.status === RUN_STATUS.COMPLETED) return sum + run.producedCm;
    return sum;
  }, 0);
}

// ── Rolls ───────────────────────────────────────────────────────────────────────
export async function insertRoll(data, session) {
  const [roll] = await Roll.create([data], { session });
  return roll.toObject();
}

export function findRollsForRun(runId) {
  return Roll.find({ runId }).sort({ producedAt: 1, _id: 1 }).lean();
}
