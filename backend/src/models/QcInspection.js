import mongoose from 'mongoose';
import { ALL_QC_RESULTS, DEFECT_SEVERITIES, DEFECT_TYPES } from '../constants/quality.js';
import { appendOnly } from './plugins/appendOnly.js';

const { Schema } = mongoose;

/**
 * One inspection of one roll (Phase 10), append-only: a reworked roll is inspected again as a new
 * attempt, and every earlier result stays in its history (instruction.md §10).
 */
const defectSchema = new Schema(
  {
    type: { type: String, required: true, enum: DEFECT_TYPES },
    severity: { type: String, required: true, enum: DEFECT_SEVERITIES },
    notes: { type: String, trim: true, maxlength: 500, default: null },
  },
  { _id: false },
);

const qcInspectionSchema = new Schema(
  {
    rollId: { type: Schema.Types.ObjectId, ref: 'Roll', required: true },
    rollNumber: { type: String, required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    runId: { type: Schema.Types.ObjectId, ref: 'ProductionRun', required: true },
    machineId: { type: Schema.Types.ObjectId, ref: 'Machine', required: true },
    attempt: { type: Number, required: true, min: 1 },
    result: { type: String, required: true, enum: ALL_QC_RESULTS },
    defects: { type: [defectSchema], default: [] },
    notes: { type: String, trim: true, maxlength: 1000, default: null },
    inspectorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    inspectorName: { type: String, required: true },
    signatureId: { type: Schema.Types.ObjectId, ref: 'Signature', default: null },
    inspectedAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);

qcInspectionSchema.index({ rollId: 1, attempt: 1 }, { unique: true });
qcInspectionSchema.index({ orderId: 1, inspectedAt: -1 });
qcInspectionSchema.index({ machineId: 1, inspectedAt: -1 });
qcInspectionSchema.index({ inspectedAt: -1 });
qcInspectionSchema.plugin(appendOnly, { collectionLabel: 'qcInspections' });

export function toPublicInspection(inspection) {
  return {
    id: String(inspection._id),
    rollId: String(inspection.rollId),
    rollNumber: inspection.rollNumber,
    orderId: String(inspection.orderId),
    runId: String(inspection.runId),
    machineId: String(inspection.machineId),
    attempt: inspection.attempt,
    result: inspection.result,
    defects: inspection.defects.map((d) => ({ type: d.type, severity: d.severity, notes: d.notes ?? null })),
    notes: inspection.notes ?? null,
    inspectorName: inspection.inspectorName,
    signatureId: inspection.signatureId ? String(inspection.signatureId) : null,
    inspectedAt: inspection.inspectedAt,
  };
}

export const QcInspection = mongoose.model('QcInspection', qcInspectionSchema);
