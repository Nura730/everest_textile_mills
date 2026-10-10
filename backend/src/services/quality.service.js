import mongoose from 'mongoose';
import { recordAudit } from '../audit/recordAudit.js';
import { ROLL_STATUS } from '../constants/production.js';
import { QC_RESULT, SIGNATURE_ENTITY, SIGNATURE_STATEMENTS } from '../constants/quality.js';
import { ROLES } from '../constants/roles.js';
import { InventoryTransaction } from '../models/InventoryTransaction.js';
import { Machine, toPublicMachine } from '../models/Machine.js';
import { ProductionRun, toPublicRun } from '../models/ProductionRun.js';
import { QcInspection, toPublicInspection } from '../models/QcInspection.js';
import { Roll, toPublicRoll } from '../models/Roll.js';
import { toPublicSignature } from '../models/Signature.js';
import { YarnLot } from '../models/YarnLot.js';
import { claimLock } from '../repositories/locks.repository.js';
import { findOrderById } from '../repositories/order.repository.js';
import { AppError } from '../utils/AppError.js';
import { dateToDateString } from '../utils/dates.js';
import { searchAcross } from '../utils/search.js';
import { cmToMetres } from '../utils/units.js';
import { executeIdempotent } from './idempotency.service.js';
import { createSignature, findSignature } from './signature.service.js';

/*
 * Phases 9 and 10: roll traceability and quality control.
 *
 *   QC_PENDING ──PASS (signed)──▶ QC_PASSED     (Phase 11 turns it into a finished good)
 *       │──REWORK──▶ IN_REWORK ──rework done──▶ QC_PENDING   (inspected again; history kept)
 *       └──REJECT──▶ REJECTED   (terminal: never becomes stock)
 *
 * Each inspection is a new append-only record (attempt 1, 2, …); REWORK and REJECT need at least one
 * defect; PASS needs the inspector's signature. Status changes are guarded and roll-locked.
 */

const rollNotFound = () => new AppError('NOT_FOUND', 'Roll not found');
const lockRoll = (id, session) => claimLock(`roll:${id}`, session);

/** Hooks run inside the inspection transaction after a PASS (Phase 11 registers finished goods here). */
const passHooks = [];
export function onRollPassed(hook) {
  passHooks.push(hook);
}

/** Hooks after a REWORK/REJECT (Phase 11: an order may become ready when its last roll is rejected). */
const afterInspectionHooks = [];
export function onRollInspected(hook) {
  afterInspectionHooks.push(hook);
}

// ── Reads ───────────────────────────────────────────────────────────────────────

export async function listRolls({ status, orderId, machineId, runId, q, page, limit }) {
  const filter = { ...searchAcross(['rollNumber', 'orderNumber', 'runNumber', 'machineCode'], q) };
  if (status) filter.status = status;
  if (orderId) filter.orderId = orderId;
  if (machineId) filter.machineId = machineId;
  if (runId) filter.runId = runId;
  // The QC queue reads oldest first; everything else newest first.
  const sort = status === ROLL_STATUS.QC_PENDING ? { producedAt: 1, _id: 1 } : { producedAt: -1, _id: -1 };
  const [rolls, total] = await Promise.all([
    Roll.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    Roll.countDocuments(filter),
  ]);
  return { rolls: rolls.map(toPublicRoll), meta: { page, limit, total } };
}

/**
 * Everything one roll can answer (instruction.md Phase 6): which order, which run and machine, when,
 * how much, from which yarn lots, and every QC attempt.
 */
export async function traceRoll(id, actor) {
  const roll = await Roll.findById(id).lean();
  if (!roll) throw rollNotFound();
  const [order, run, machine, inspections, lots, signature] = await Promise.all([
    findOrderById(roll.orderId),
    ProductionRun.findById(roll.runId).lean(),
    Machine.findById(roll.machineId).lean(),
    QcInspection.find({ rollId: roll._id }).sort({ attempt: 1 }).lean(),
    YarnLot.find({ _id: { $in: roll.yarnLots.map((l) => l.yarnLotId) } }).lean(),
    findSignature(SIGNATURE_ENTITY.QC_INSPECTION, roll._id),
  ]);
  const issues = await InventoryTransaction.find({ orderId: roll.orderId, type: 'ISSUE' }).lean();
  return {
    roll: toPublicRoll(roll),
    order: order && {
      id: String(order._id),
      orderNumber: order.orderNumber,
      status: order.status,
      buyer: { code: order.buyer.code, name: order.buyer.name },
      product: { code: order.product.code, name: order.product.name, material: order.product.material, colour: order.product.colour },
      quantityMetres: cmToMetres(order.quantityCm),
      requiredBy: dateToDateString(order.requiredBy),
    },
    run: run && toPublicRun(run),
    machine: machine && toPublicMachine(machine),
    yarnLots: lots.map((lot) => ({
      id: String(lot._id),
      lotNumber: lot.lotNumber,
      material: lot.material,
      colour: lot.colour,
      supplierName: lot.supplierName,
      receivedAt: lot.receivedAt,
      issuedToOrderKg: issues.filter((tx) => String(tx.yarnLotId) === String(lot._id)).reduce((sum, tx) => sum - tx.deltaTotalGrams, 0) / 1000,
    })),
    inspections: inspections.map(toPublicInspection),
    qcSignature: signature ? toPublicSignature(signature, { includeImage: actor.role === ROLES.ADMIN || actor.role === ROLES.QC_INSPECTOR }) : null,
  };
}

// ── Inspection ──────────────────────────────────────────────────────────────────

const NEXT_STATUS = { PASS: ROLL_STATUS.QC_PASSED, REWORK: ROLL_STATUS.IN_REWORK, REJECT: ROLL_STATUS.REJECTED };

/**
 * Inspect a QC_PENDING roll (QC_INSPECTOR or ADMIN). PASS needs a signature
 * ({ accepted: true, image }) and creates it in the same transaction; REWORK and REJECT need defects.
 */
export function inspectRoll(rollId, { result, defects = [], notes, signature }, context) {
  return executeIdempotent(
    { context, operation: 'ROLL_INSPECT', request: { rollId, result, defects, notes, signed: Boolean(signature) } },
    async (session) => {
      await lockRoll(rollId, session);
      const roll = await Roll.findById(rollId).session(session).lean();
      if (!roll) throw rollNotFound();
      if (roll.status !== ROLL_STATUS.QC_PENDING) {
        throw new AppError('INVALID_STATE_TRANSITION', `Roll ${roll.rollNumber} is ${roll.status}; only rolls awaiting QC can be inspected`, {
          details: { from: roll.status, to: NEXT_STATUS[result], allowedFrom: [ROLL_STATUS.QC_PENDING] },
        });
      }
      if (result !== QC_RESULT.PASS && defects.length === 0) {
        throw new AppError('VALIDATION_ERROR', 'Request validation failed', {
          details: [{ location: 'body', path: 'defects', message: `record at least one defect for ${result}` }],
        });
      }
      if (result === QC_RESULT.PASS && !signature) {
        throw new AppError('SIGNATURE_REQUIRED', 'A QC pass must be signed by the inspector', {
          details: { statement: SIGNATURE_STATEMENTS.QC_INSPECTION(roll.rollNumber) },
        });
      }

      const attempt = roll.reworkCount + 1;
      // The inspection id is fixed first so the signature can cover it and the inspection can be
      // written once, already linked to its signature (append-only: never updated afterwards).
      const inspectionId = new mongoose.Types.ObjectId();
      let signatureId = null;
      if (result === QC_RESULT.PASS) {
        const signed = await createSignature(
          {
            entityType: SIGNATURE_ENTITY.QC_INSPECTION,
            entityId: roll._id,
            statement: SIGNATURE_STATEMENTS.QC_INSPECTION(roll.rollNumber),
            record: { rollNumber: roll.rollNumber, lengthCm: roll.lengthCm, attempt, result, inspectionId: String(inspectionId) },
            image: signature.image,
          },
          context,
          session,
        );
        signatureId = signed._id;
      }
      const [inspection] = await QcInspection.create(
        [
          {
            _id: inspectionId,
            rollId: roll._id,
            rollNumber: roll.rollNumber,
            orderId: roll.orderId,
            runId: roll.runId,
            machineId: roll.machineId,
            attempt,
            result,
            defects,
            notes: notes ?? null,
            inspectorId: context.actor.id,
            inspectorName: context.actor.name,
            signatureId,
          },
        ],
        { session },
      );

      const updated = await Roll.findOneAndUpdate(
        { _id: roll._id, status: ROLL_STATUS.QC_PENDING },
        { $set: { status: NEXT_STATUS[result] } },
        { returnDocument: 'after', session, lean: true },
      );
      if (!updated) throw new AppError('CONFLICT', 'The roll changed meanwhile. Reload and try again.');

      await recordAudit(
        {
          action: result === QC_RESULT.PASS ? 'QC_PASSED' : result === QC_RESULT.REWORK ? 'QC_REWORK' : 'QC_REJECTED',
          entityType: 'Roll',
          entityId: roll._id,
          orderId: roll.orderId,
          machineId: roll.machineId,
          before: { status: roll.status },
          after: { status: updated.status, attempt, defects: defects.map((d) => d.type), signed: Boolean(signatureId) },
        },
        context,
        session,
      );

      let extra = {};
      if (result === QC_RESULT.PASS) {
        for (const hook of passHooks) Object.assign(extra, (await hook(updated, context, session)) ?? {});
      } else {
        for (const hook of afterInspectionHooks) Object.assign(extra, (await hook(updated, context, session)) ?? {});
      }
      const fresh = await Roll.findById(roll._id).session(session).lean();
      return {
        statusCode: 201,
        body: { roll: toPublicRoll(fresh), inspection: toPublicInspection(inspection.toObject()), ...extra },
      };
    },
  );
}

/** Rework done on the floor (FLOOR_MANAGER or ADMIN): the roll goes back to the QC queue. */
export function completeRework(rollId, { note }, context) {
  return executeIdempotent({ context, operation: 'ROLL_REWORK_DONE', request: { rollId, note } }, async (session) => {
    await lockRoll(rollId, session);
    const roll = await Roll.findById(rollId).session(session).lean();
    if (!roll) throw rollNotFound();
    if (roll.status !== ROLL_STATUS.IN_REWORK) {
      throw new AppError('INVALID_STATE_TRANSITION', `Roll ${roll.rollNumber} is ${roll.status}; only rolls in rework can be returned to QC`, {
        details: { from: roll.status, to: ROLL_STATUS.QC_PENDING, allowedFrom: [ROLL_STATUS.IN_REWORK] },
      });
    }
    const updated = await Roll.findOneAndUpdate(
      { _id: roll._id, status: ROLL_STATUS.IN_REWORK },
      { $set: { status: ROLL_STATUS.QC_PENDING }, $inc: { reworkCount: 1 } },
      { returnDocument: 'after', session, lean: true },
    );
    await recordAudit(
      {
        action: 'ROLL_REWORK_DONE',
        entityType: 'Roll',
        entityId: roll._id,
        orderId: roll.orderId,
        machineId: roll.machineId,
        before: { status: roll.status, reworkCount: roll.reworkCount },
        after: { status: ROLL_STATUS.QC_PENDING, reworkCount: updated.reworkCount, note: note ?? null },
      },
      context,
      session,
    );
    return { statusCode: 200, body: { roll: toPublicRoll(updated) } };
  });
}

/** Inspection history across rolls (QC dashboard): filter by order, machine, result. */
export async function listInspections({ orderId, machineId, result, page, limit }) {
  const filter = {};
  if (orderId) filter.orderId = orderId;
  if (machineId) filter.machineId = machineId;
  if (result) filter.result = result;
  const [inspections, total] = await Promise.all([
    QcInspection.find(filter).sort({ inspectedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    QcInspection.countDocuments(filter),
  ]);
  return { inspections: inspections.map(toPublicInspection), meta: { page, limit, total } };
}

/** QC summary for dashboards: rolls by status and pass / rework / reject counts. */
export async function qualitySummary() {
  const [byStatus, byResult] = await Promise.all([
    Roll.aggregate([{ $group: { _id: '$status', rolls: { $sum: 1 }, lengthCm: { $sum: '$lengthCm' } } }]),
    QcInspection.aggregate([{ $group: { _id: '$result', count: { $sum: 1 } } }]),
  ]);
  return {
    rolls: Object.fromEntries(byStatus.map((row) => [row._id, { rolls: row.rolls, metres: cmToMetres(row.lengthCm) }])),
    inspections: Object.fromEntries(byResult.map((row) => [row._id, row.count])),
  };
}
