import { recordAudit } from '../audit/recordAudit.js';
import { MACHINE_STATUS } from '../constants/machines.js';
import { ORDER_STATUS } from '../constants/orderStatus.js';
import { OPEN_RUN_STATUSES, ROLL_STATUS, RUN_STATUS } from '../constants/production.js';
import { onFloorGrams } from '../models/MaterialReservation.js';
import { Roll } from '../models/Roll.js';
import { toPublicOrder } from '../models/Order.js';
import { toPublicRoll } from '../models/Roll.js';
import { toPublicRun } from '../models/ProductionRun.js';
import { findProductById } from '../repositories/catalog.repository.js';
import { claimLock } from '../repositories/locks.repository.js';
import { appendMachineEvent, findMachineById, transitionMachineGuarded } from '../repositories/machine.repository.js';
import { findReservationsForOrder } from '../repositories/materialReservation.repository.js';
import { findOrderById, nextSequence, transitionStatusGuarded } from '../repositories/order.repository.js';
import {
  addOutputToRun,
  findRollsForRun,
  findRunById,
  findRunsForOrder,
  findRunsPage,
  insertRoll,
  insertRun,
  plannedCmForOrder,
  transitionRunGuarded,
} from '../repositories/production.repository.js';
import { AppError } from '../utils/AppError.js';
import { todayInIndia } from '../utils/dates.js';
import { cmToMetres, kgToGrams, metresToCm } from '../utils/units.js';
import { refreshDispatchReadiness } from './fulfilment.service.js';
import { executeIdempotent } from './idempotency.service.js';

/*
 * Phase 8: production runs (D3: single stage — one order on one machine of the fabric's type).
 *
 *   plan     order MATERIAL_RESERVED/IN_PRODUCTION, machine AVAILABLE & right type  → run PLANNED, machine ASSIGNED
 *   start    run PLANNED, machine ASSIGNED to it (never DOWN/MAINTENANCE), yarn on the floor
 *            → run RUNNING, machine RUNNING, order MATERIAL_RESERVED → IN_PRODUCTION (first start)
 *   pause    RUNNING → PAUSED (run and machine)        resume  PAUSED → RUNNING (machine must not be DOWN)
 *   record   a roll (length, weight) while RUNNING/PAUSED; run.producedCm = Σ roll lengths
 *   complete RUNNING/PAUSED with ≥ 1 roll → COMPLETED, machine freed; when no run is open and the
 *            produced total covers the order → order IN_PRODUCTION → PRODUCTION_COMPLETED
 *   cancel   PLANNED → CANCELLED, machine freed
 *   reopen   COMPLETED → PAUSED, only for a run completed by mistake: it produced less than its target,
 *            its order still needs output (IN_PRODUCTION) and its machine is free. Reason required;
 *            history and rolls are kept; the machine is booked again (PAUSED) until the run resumes.
 *   output   never beyond the order: good or pending output (rejected rolls excluded, they must be
 *            remade) plus a new roll may not exceed the ordered quantity.
 *
 * Every action locks the order and the machine (two runs completing at once cannot both miss that
 * the order is done), writes run history + machine event + audit in one transaction, with an
 * Idempotency-Key.
 */

const lockOrder = (id, session) => claimLock(`order:${id}`, session);
const lockMachine = (id, session) => claimLock(`machine:${id}`, session);
const runNotFound = () => new AppError('NOT_FOUND', 'Production run not found');
const PRODUCIBLE_ORDER_STATUSES = [ORDER_STATUS.MATERIAL_RESERVED, ORDER_STATUS.IN_PRODUCTION];

function runInvalid(run, to, allowedFrom) {
  return new AppError('INVALID_STATE_TRANSITION', `A run that is ${run.status} cannot become ${to}`, {
    details: { from: run.status, to, allowedFrom },
  });
}

function change(context, from, to, reason = null) {
  return { from, to, at: new Date(), by: context.actor.id, byRole: context.actor.role, reason };
}

async function machineEvent(machine, run, toStatus, note, context, session) {
  await appendMachineEvent(
    {
      machineId: machine._id,
      runId: run._id,
      type: 'STATUS_CHANGED',
      fromStatus: machine.status,
      toStatus,
      note,
      actorId: context.actor.id,
      actorRole: context.actor.role,
      source: context.source ?? 'ONLINE',
    },
    session,
  );
}

async function moveMachine(machine, to, set, session) {
  const updated = await transitionMachineGuarded(machine._id, machine.status, { status: to, ...set }, session);
  if (!updated) throw new AppError('CONFLICT', 'The machine changed meanwhile. Reload and try again.');
  return updated;
}

/**
 * Frees a machine when its run ends. A DOWN machine stays DOWN (its repair is separate) but will come
 * back AVAILABLE instead of to a run that no longer exists.
 */
async function releaseMachine(machine, run, context, session) {
  if (machine.status === MACHINE_STATUS.DOWN) {
    await moveMachine(machine, MACHINE_STATUS.DOWN, { statusBeforeDown: MACHINE_STATUS.AVAILABLE, currentRunId: null }, session);
    return;
  }
  await moveMachine(machine, MACHINE_STATUS.AVAILABLE, { currentRunId: null }, session);
  await machineEvent(machine, run, MACHINE_STATUS.AVAILABLE, `Run ${run.runNumber} ${run.status === RUN_STATUS.PLANNED ? 'cancelled' : 'completed'}`, context, session);
}

const audit = (action, run, extra, context, session) =>
  recordAudit({ action, entityType: 'ProductionRun', entityId: run._id, orderId: run.orderId, machineId: run.machineId, ...extra }, context, session);

/** Plan a run: book a machine of the fabric's type for part (or all) of a reserved order. */
export function planRun({ orderId, machineId, targetMetres, plannedStartAt, note }, context) {
  return executeIdempotent(
    { context, operation: 'RUN_PLAN', request: { orderId, machineId, targetMetres, plannedStartAt, note } },
    async (session) => {
      await lockOrder(orderId, session);
      await lockMachine(machineId, session);
      const order = await findOrderById(orderId, { session });
      if (!order) throw new AppError('NOT_FOUND', 'Order not found');
      if (!PRODUCIBLE_ORDER_STATUSES.includes(order.status)) {
        throw new AppError('CONFLICT', `Production can be planned only after the yarn is reserved (this order is ${order.status})`, {
          details: { status: order.status, requiredStatuses: PRODUCIBLE_ORDER_STATUSES },
        });
      }
      const machine = await findMachineById(machineId, { session });
      if (!machine) throw new AppError('NOT_FOUND', 'Machine not found');
      if (!machine.isActive) throw new AppError('MACHINE_INACTIVE', `Machine ${machine.code} is retired`);
      const product = await findProductById(order.productId, { session });
      const neededType = product?.machineType ?? 'WEAVING';
      if (machine.type !== neededType) {
        throw new AppError('VALIDATION_ERROR', 'Request validation failed', {
          details: [{ location: 'body', path: 'machineId', message: `${machine.code} is a ${machine.type} machine; this fabric is made on ${neededType}` }],
        });
      }
      if (machine.status !== MACHINE_STATUS.AVAILABLE) {
        throw new AppError('INVALID_STATE_TRANSITION', `Machine ${machine.code} is ${machine.status}, not available`, {
          details: { from: machine.status, to: MACHINE_STATUS.ASSIGNED, allowedFrom: [MACHINE_STATUS.AVAILABLE] },
        });
      }

      const targetCm = metresToCm(targetMetres);
      const runs = await findRunsForOrder(order._id, { session });
      const remainingCm = order.quantityCm - plannedCmForOrder(runs);
      if (targetCm > remainingCm) {
        throw new AppError('QUANTITY_EXCEEDS_ORDER', `Only ${cmToMetres(Math.max(0, remainingCm))} m of this order is left to plan`, {
          details: { orderMetres: cmToMetres(order.quantityCm), remainingMetres: cmToMetres(Math.max(0, remainingCm)), requestedMetres: targetMetres },
        });
      }

      const year = todayInIndia().slice(0, 4);
      const runNumber = `RUN-${year}-${String(await nextSequence(`run:${year}`, session)).padStart(4, '0')}`;
      const run = await insertRun(
        {
          runNumber,
          orderId: order._id,
          orderNumber: order.orderNumber,
          machineId: machine._id,
          machineCode: machine.code,
          targetCm,
          status: RUN_STATUS.PLANNED,
          statusHistory: [change(context, null, RUN_STATUS.PLANNED)],
          plannedStartAt: plannedStartAt ? new Date(plannedStartAt) : null,
          supervisorId: context.actor.id,
          note: note ?? null,
        },
        session,
      );
      await moveMachine(machine, MACHINE_STATUS.ASSIGNED, { currentRunId: run._id }, session);
      await machineEvent(machine, run, MACHINE_STATUS.ASSIGNED, `Run ${runNumber} planned for ${order.orderNumber}`, context, session);
      await audit('RUN_PLANNED', run, { after: { runNumber, orderNumber: order.orderNumber, machineCode: machine.code, targetCm } }, context, session);
      return { statusCode: 201, body: { run: toPublicRun(run) } };
    },
  );
}

/** Shared shape of a run action: lock order + machine, load, check, act, audit. */
function runAction({ id, operation, request, context }, work) {
  return executeIdempotent({ context, operation, request: { id, ...request } }, async (session) => {
    const preview = await findRunById(id, { session });
    if (!preview) throw runNotFound();
    await lockOrder(preview.orderId, session);
    await lockMachine(preview.machineId, session);
    const run = await findRunById(id, { session });
    const machine = await findMachineById(run.machineId, { session });
    const order = await findOrderById(run.orderId, { session });
    const result = await work({ run, machine, order }, session);
    const fresh = await findRunById(id, { session });
    return { statusCode: result?.statusCode ?? 200, body: { run: toPublicRun(fresh), ...(result?.body ?? {}) } };
  });
}

export const startRun = (id, context) =>
  runAction({ id, operation: 'RUN_START', request: {}, context }, async ({ run, machine, order }, session) => {
    if (run.status !== RUN_STATUS.PLANNED) throw runInvalid(run, RUN_STATUS.RUNNING, [RUN_STATUS.PLANNED]);
    if (machine.status !== MACHINE_STATUS.ASSIGNED || String(machine.currentRunId) !== String(run._id)) {
      throw new AppError('INVALID_STATE_TRANSITION', `Machine ${machine.code} is ${machine.status} and cannot start this run`, {
        details: { machineStatus: machine.status, to: MACHINE_STATUS.RUNNING, allowedFrom: [MACHINE_STATUS.ASSIGNED] },
      });
    }
    if (!PRODUCIBLE_ORDER_STATUSES.includes(order.status)) {
      throw new AppError('CONFLICT', `Order ${order.orderNumber} is ${order.status}; it cannot go into production`, { details: { status: order.status } });
    }
    const reservations = await findReservationsForOrder(order._id, { session });
    if (reservations.reduce((sum, r) => sum + onFloorGrams(r), 0) <= 0) {
      throw new AppError('YARN_NOT_ISSUED', 'Issue the reserved yarn to the floor before starting production', {
        details: { orderNumber: order.orderNumber },
      });
    }

    const updated = await transitionRunGuarded(run._id, [RUN_STATUS.PLANNED], RUN_STATUS.RUNNING, change(context, run.status, RUN_STATUS.RUNNING), session, { startedAt: new Date() });
    if (!updated) throw runInvalid(run, RUN_STATUS.RUNNING, [RUN_STATUS.PLANNED]);
    await moveMachine(machine, MACHINE_STATUS.RUNNING, {}, session);
    await machineEvent(machine, run, MACHINE_STATUS.RUNNING, `Run ${run.runNumber} started`, context, session);

    let orderAfter = order;
    if (order.status === ORDER_STATUS.MATERIAL_RESERVED) {
      orderAfter = await transitionStatusGuarded(
        order._id,
        ORDER_STATUS.MATERIAL_RESERVED,
        ORDER_STATUS.IN_PRODUCTION,
        { from: order.status, to: ORDER_STATUS.IN_PRODUCTION, at: new Date(), by: context.actor.id, byRole: context.actor.role, reason: `Run ${run.runNumber} started` },
        session,
      );
    }
    await audit('RUN_STARTED', run, { before: { status: run.status, orderStatus: order.status }, after: { status: RUN_STATUS.RUNNING, orderStatus: orderAfter.status } }, context, session);
    return { body: { order: toPublicOrder(orderAfter, context.actor) } };
  });

export const pauseRun = (id, { reason }, context) =>
  runAction({ id, operation: 'RUN_PAUSE', request: { reason }, context }, async ({ run, machine }, session) => {
    if (run.status !== RUN_STATUS.RUNNING) throw runInvalid(run, RUN_STATUS.PAUSED, [RUN_STATUS.RUNNING]);
    const updated = await transitionRunGuarded(run._id, [RUN_STATUS.RUNNING], RUN_STATUS.PAUSED, change(context, run.status, RUN_STATUS.PAUSED, reason), session);
    if (!updated) throw runInvalid(run, RUN_STATUS.PAUSED, [RUN_STATUS.RUNNING]);
    if (machine.status === MACHINE_STATUS.RUNNING) {
      await moveMachine(machine, MACHINE_STATUS.PAUSED, {}, session);
      await machineEvent(machine, run, MACHINE_STATUS.PAUSED, `Run ${run.runNumber} paused: ${reason}`, context, session);
    }
    await audit('RUN_PAUSED', run, { before: { status: run.status }, after: { status: RUN_STATUS.PAUSED, reason } }, context, session);
  });

export const resumeRun = (id, context) =>
  runAction({ id, operation: 'RUN_RESUME', request: {}, context }, async ({ run, machine }, session) => {
    if (run.status !== RUN_STATUS.PAUSED) throw runInvalid(run, RUN_STATUS.RUNNING, [RUN_STATUS.PAUSED]);
    if (machine.status !== MACHINE_STATUS.PAUSED) {
      throw new AppError('INVALID_STATE_TRANSITION', `Machine ${machine.code} is ${machine.status}; resolve that first`, {
        details: { machineStatus: machine.status, to: MACHINE_STATUS.RUNNING, allowedFrom: [MACHINE_STATUS.PAUSED] },
      });
    }
    const updated = await transitionRunGuarded(run._id, [RUN_STATUS.PAUSED], RUN_STATUS.RUNNING, change(context, run.status, RUN_STATUS.RUNNING), session);
    if (!updated) throw runInvalid(run, RUN_STATUS.RUNNING, [RUN_STATUS.PAUSED]);
    await moveMachine(machine, MACHINE_STATUS.RUNNING, {}, session);
    await machineEvent(machine, run, MACHINE_STATUS.RUNNING, `Run ${run.runNumber} resumed`, context, session);
    await audit('RUN_RESUMED', run, { before: { status: run.status }, after: { status: RUN_STATUS.RUNNING } }, context, session);
  });

/** Record one produced roll against a producing run. The roll carries its traceability. */
export const recordRoll = (id, { lengthMetres, weightKg }, context) =>
  runAction({ id, operation: 'RUN_RECORD_ROLL', request: { lengthMetres, weightKg }, context }, async ({ run, order }, session) => {
    if (![RUN_STATUS.RUNNING, RUN_STATUS.PAUSED].includes(run.status)) {
      throw new AppError('CONFLICT', `Output can be recorded only on a running or paused run (this one is ${run.status})`, { details: { status: run.status } });
    }
    const lengthCm = metresToCm(lengthMetres);
    // Never produce beyond the order. Rejected rolls do not count: they have to be made again.
    const runs = await findRunsForOrder(order._id, { session });
    const producedCm = runs.filter((r) => r.status !== RUN_STATUS.CANCELLED).reduce((sum, r) => sum + r.producedCm, 0);
    const [rejected] = await Roll.aggregate([{ $match: { orderId: order._id, status: ROLL_STATUS.REJECTED } }, { $group: { _id: null, cm: { $sum: '$lengthCm' } } }]).session(session);
    const goodCm = producedCm - (rejected?.cm ?? 0);
    if (goodCm + lengthCm > order.quantityCm) {
      throw new AppError('QUANTITY_EXCEEDS_ORDER', `Only ${cmToMetres(Math.max(0, order.quantityCm - goodCm))} m of order ${order.orderNumber} is still to be produced`, {
        details: { orderedMetres: cmToMetres(order.quantityCm), producedMetres: cmToMetres(goodCm), remainingMetres: cmToMetres(Math.max(0, order.quantityCm - goodCm)), requestedMetres: lengthMetres },
      });
    }
    const reservations = await findReservationsForOrder(run.orderId, { session });
    const yarnLots = reservations.filter((r) => r.issuedGrams > 0).map((r) => ({ yarnLotId: r.yarnLotId, lotNumber: r.lotNumber }));
    const year = todayInIndia().slice(0, 4);
    const rollNumber = `ROLL-${year}-${String(await nextSequence(`roll:${year}`, session)).padStart(5, '0')}`;
    const roll = await insertRoll(
      {
        rollNumber,
        orderId: run.orderId,
        orderNumber: run.orderNumber,
        runId: run._id,
        runNumber: run.runNumber,
        machineId: run.machineId,
        machineCode: run.machineCode,
        yarnLots,
        lengthCm,
        weightGrams: weightKg === undefined ? null : kgToGrams(weightKg),
        producedBy: context.actor.id,
      },
      session,
    );
    const updated = await addOutputToRun(run._id, lengthCm, session);
    if (!updated) throw new AppError('CONFLICT', 'The run changed meanwhile. Reload and try again.');
    await audit('ROLL_RECORDED', run, { entityType: 'Roll', entityId: roll._id, after: { rollNumber, lengthCm, weightGrams: roll.weightGrams, runNumber: run.runNumber } }, context, session);
    return { statusCode: 201, body: { roll: toPublicRoll(roll) } };
  });

/**
 * Complete a run (at least one roll recorded). Frees the machine. When no run of the order is still
 * open and the produced total covers the ordered quantity, the order becomes PRODUCTION_COMPLETED;
 * otherwise it stays IN_PRODUCTION for another run.
 */
export const completeRun = (id, { note, shortfallReason }, context) =>
  runAction({ id, operation: 'RUN_COMPLETE', request: { note, shortfallReason }, context }, async ({ run, machine, order }, session) => {
    if (![RUN_STATUS.RUNNING, RUN_STATUS.PAUSED].includes(run.status)) throw runInvalid(run, RUN_STATUS.COMPLETED, [RUN_STATUS.RUNNING, RUN_STATUS.PAUSED]);
    if (run.rollCount === 0) {
      throw new AppError('NO_OUTPUT_RECORDED', 'Record at least one roll before completing the run', { details: { runNumber: run.runNumber } });
    }
    // A run below its target is never completed by a plain click: the shortfall is stated and recorded.
    const shortCm = Math.max(0, run.targetCm - run.producedCm);
    if (shortCm > 0 && !shortfallReason) {
      throw new AppError('SHORTFALL_REASON_REQUIRED', `${run.runNumber} produced ${cmToMetres(run.producedCm)} m of its ${cmToMetres(run.targetCm)} m target. To complete it short, give the reason for the ${cmToMetres(shortCm)} m shortfall; otherwise keep producing.`, {
        details: { producedMetres: cmToMetres(run.producedCm), targetMetres: cmToMetres(run.targetCm), shortMetres: cmToMetres(shortCm) },
      });
    }
    const historyReason = shortCm > 0 ? `Completed short by ${cmToMetres(shortCm)} m: ${shortfallReason}` : (note ?? null);
    const updated = await transitionRunGuarded(
      run._id,
      [RUN_STATUS.RUNNING, RUN_STATUS.PAUSED],
      RUN_STATUS.COMPLETED,
      change(context, run.status, RUN_STATUS.COMPLETED, historyReason),
      session,
      { completedAt: new Date() },
    );
    if (!updated) throw runInvalid(run, RUN_STATUS.COMPLETED, [RUN_STATUS.RUNNING, RUN_STATUS.PAUSED]);
    await releaseMachine(machine, updated, context, session);

    let orderAfter = order;
    const runs = await findRunsForOrder(order._id, { session });
    const producedCm = runs.filter((r) => r.status === RUN_STATUS.COMPLETED).reduce((sum, r) => sum + r.producedCm, 0);
    const anyOpen = runs.some((r) => OPEN_RUN_STATUSES.includes(r.status));
    if (!anyOpen && producedCm >= order.quantityCm && order.status === ORDER_STATUS.IN_PRODUCTION) {
      orderAfter = await transitionStatusGuarded(
        order._id,
        ORDER_STATUS.IN_PRODUCTION,
        ORDER_STATUS.PRODUCTION_COMPLETED,
        { from: order.status, to: ORDER_STATUS.PRODUCTION_COMPLETED, at: new Date(), by: context.actor.id, byRole: context.actor.role, reason: `${cmToMetres(producedCm)} m produced` },
        session,
      );
      // Rolls may already have passed QC while the run was producing.
      orderAfter = (await refreshDispatchReadiness(order._id, context, session)) ?? orderAfter;
    }
    await audit(
      'RUN_COMPLETED',
      run,
      { before: { status: run.status }, after: { status: RUN_STATUS.COMPLETED, producedCm: run.producedCm, rollCount: run.rollCount, orderStatus: orderAfter.status, ...(shortCm > 0 ? { shortfallCm: shortCm, shortfallReason } : {}) } },
      context,
      session,
    );
    return { body: { order: toPublicOrder(orderAfter, context.actor), orderProducedMetres: cmToMetres(producedCm) } };
  });

/**
 * Reopen a run that was completed by mistake (FLOOR_MANAGER or ADMIN). Explicit and narrow: the run
 * produced less than its target, its order is still IN_PRODUCTION and short of its quantity, nothing
 * else already covers the gap, and the run's machine is free. The run goes back to PAUSED on the same
 * machine (resume it to continue); its rolls and history stay; the correction is audited with the
 * reason and the values before and after. Retrying with the same key replays; it cannot reopen twice.
 */
export const reopenRun = (id, { reason }, context) =>
  runAction({ id, operation: 'RUN_REOPEN', request: { reason }, context }, async ({ run, machine, order }, session) => {
    if (run.status !== RUN_STATUS.COMPLETED) throw runInvalid(run, RUN_STATUS.PAUSED, [RUN_STATUS.COMPLETED]);
    if (run.producedCm >= run.targetCm) {
      throw new AppError('INVALID_STATE_TRANSITION', `Run ${run.runNumber} reached its target (${cmToMetres(run.producedCm)} m); only a run that ended short can be reopened`, {
        details: { reason: 'RUN_REACHED_TARGET', producedMetres: cmToMetres(run.producedCm), targetMetres: cmToMetres(run.targetCm) },
      });
    }
    if (order.status !== ORDER_STATUS.IN_PRODUCTION) {
      throw new AppError('INVALID_STATE_TRANSITION', `Order ${order.orderNumber} is ${order.status}; a run can be reopened only while its order is in production`, {
        details: { reason: 'ORDER_NOT_IN_PRODUCTION', orderStatus: order.status },
      });
    }
    const runs = await findRunsForOrder(order._id, { session });
    const reopened = runs.map((r) => (String(r._id) === String(run._id) ? { ...r, status: RUN_STATUS.PAUSED } : r));
    if (plannedCmForOrder(reopened) > order.quantityCm) {
      throw new AppError('QUANTITY_EXCEEDS_ORDER', `Other runs already cover the rest of order ${order.orderNumber}; continue on those instead`, {
        details: { reason: 'GAP_ALREADY_PLANNED', orderedMetres: cmToMetres(order.quantityCm) },
      });
    }
    if (machine.status !== MACHINE_STATUS.AVAILABLE) {
      throw new AppError('INVALID_STATE_TRANSITION', `Machine ${machine.code} is ${machine.status}; it must be available to take the run back. Plan a continuation run on another machine instead.`, {
        details: { reason: 'MACHINE_NOT_AVAILABLE', machineStatus: machine.status },
      });
    }

    const updated = await transitionRunGuarded(
      run._id,
      [RUN_STATUS.COMPLETED],
      RUN_STATUS.PAUSED,
      change(context, run.status, RUN_STATUS.PAUSED, `Reopened (completed by mistake): ${reason}`),
      session,
      { completedAt: null },
    );
    if (!updated) throw runInvalid(run, RUN_STATUS.PAUSED, [RUN_STATUS.COMPLETED]);
    await moveMachine(machine, MACHINE_STATUS.PAUSED, { currentRunId: run._id }, session);
    await machineEvent(machine, run, MACHINE_STATUS.PAUSED, `Run ${run.runNumber} reopened: ${reason}`, context, session);
    const orderProducedCm = runs.filter((r) => r.status === RUN_STATUS.COMPLETED).reduce((sum, r) => sum + r.producedCm, 0);
    await audit(
      'RUN_REOPENED',
      run,
      {
        before: { status: RUN_STATUS.COMPLETED, producedCm: run.producedCm, targetCm: run.targetCm, completedAt: run.completedAt },
        after: { status: RUN_STATUS.PAUSED, reason, runRemainingCm: run.targetCm - run.producedCm, orderRemainingCm: order.quantityCm - orderProducedCm },
      },
      context,
      session,
    );
  });

export const cancelRun = (id, { reason }, context) =>
  runAction({ id, operation: 'RUN_CANCEL', request: { reason }, context }, async ({ run, machine }, session) => {
    if (run.status !== RUN_STATUS.PLANNED) throw runInvalid(run, RUN_STATUS.CANCELLED, [RUN_STATUS.PLANNED]);
    await cancelPlannedRun(run, machine, reason, context, session);
  });

async function cancelPlannedRun(run, machine, reason, context, session) {
  const updated = await transitionRunGuarded(run._id, [RUN_STATUS.PLANNED], RUN_STATUS.CANCELLED, change(context, run.status, RUN_STATUS.CANCELLED, reason), session);
  if (!updated) throw runInvalid(run, RUN_STATUS.CANCELLED, [RUN_STATUS.PLANNED]);
  if (machine && String(machine.currentRunId) === String(run._id)) await releaseMachine(machine, run, context, session);
  await audit('RUN_CANCELLED', run, { before: { status: run.status }, after: { status: RUN_STATUS.CANCELLED, reason } }, context, session);
}

/**
 * Cancelling an order cancels its planned runs and frees their machines (called inside the order
 * cancellation transaction). Only PLANNED runs can exist for a cancellable order: the first start
 * moves the order to IN_PRODUCTION, which cannot be cancelled.
 */
export async function cancelPlannedRunsForOrder(order, { reason }, context, session) {
  const runs = await findRunsForOrder(order._id, { session });
  for (const run of runs.filter((r) => r.status === RUN_STATUS.PLANNED)) {
    await lockMachine(run.machineId, session);
    const machine = await findMachineById(run.machineId, { session });
    await cancelPlannedRun(run, machine, `Order cancelled: ${reason}`, context, session);
  }
}

// ── Reads ───────────────────────────────────────────────────────────────────────

export async function listRuns({ orderId, machineId, status, page, limit }) {
  const { runs, total } = await findRunsPage({ orderId, machineId, status }, { page, limit });
  return { runs: runs.map(toPublicRun), meta: { page, limit, total } };
}

export async function getRun(id) {
  const run = await findRunById(id);
  if (!run) throw runNotFound();
  const rolls = await findRollsForRun(run._id);
  return { run: toPublicRun(run), rolls: rolls.map(toPublicRoll) };
}
