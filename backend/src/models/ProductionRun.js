import mongoose from 'mongoose';
import { ALL_RUN_STATUSES, RUN_STATUS } from '../constants/production.js';
import { cmToMetres } from '../utils/units.js';

const { Schema } = mongoose;

const integer = { validator: Number.isInteger, message: '{PATH} must be an integer' };

const runChangeSchema = new Schema(
  {
    from: { type: String, enum: [...ALL_RUN_STATUSES, null], default: null },
    to: { type: String, required: true, enum: ALL_RUN_STATUSES },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    byRole: { type: String, required: true },
    reason: { type: String, default: null },
  },
  { _id: false },
);

/**
 * One order produced on one machine (Phase 8, D3 single stage).
 *   PLANNED ──start──▶ RUNNING ⇄ PAUSED ──complete──▶ COMPLETED
 *      └──cancel──▶ CANCELLED
 * producedCm is the sum of the run's roll lengths (each roll recorded with its length).
 * Status changes are guarded updates; statusHistory is the small per-run timeline, the audit log
 * and machine events stay the full record.
 */
const productionRunSchema = new Schema(
  {
    runNumber: { type: String, required: true, unique: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    orderNumber: { type: String, required: true },
    machineId: { type: Schema.Types.ObjectId, ref: 'Machine', required: true },
    machineCode: { type: String, required: true },
    targetCm: { type: Number, required: true, min: 1, validate: integer },
    producedCm: { type: Number, default: 0, min: 0, validate: integer },
    rollCount: { type: Number, default: 0, min: 0, validate: integer },
    status: { type: String, required: true, enum: ALL_RUN_STATUSES, default: RUN_STATUS.PLANNED },
    statusHistory: { type: [runChangeSchema], default: [] },
    plannedStartAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    supervisorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String, trim: true, maxlength: 500, default: null },
  },
  { timestamps: true },
);

productionRunSchema.index({ orderId: 1, createdAt: 1 });
productionRunSchema.index({ machineId: 1, createdAt: -1 });
productionRunSchema.index({ status: 1, createdAt: -1 });

export function toPublicRun(run) {
  return {
    id: String(run._id),
    runNumber: run.runNumber,
    orderId: String(run.orderId),
    orderNumber: run.orderNumber,
    machineId: String(run.machineId),
    machineCode: run.machineCode,
    targetMetres: cmToMetres(run.targetCm),
    producedMetres: cmToMetres(run.producedCm),
    rollCount: run.rollCount,
    status: run.status,
    statusHistory: run.statusHistory.map((c) => ({ from: c.from ?? null, to: c.to, at: c.at, byRole: c.byRole, reason: c.reason ?? null })),
    plannedStartAt: run.plannedStartAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    supervisorId: String(run.supervisorId),
    note: run.note ?? null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

export const ProductionRun = mongoose.model('ProductionRun', productionRunSchema);
