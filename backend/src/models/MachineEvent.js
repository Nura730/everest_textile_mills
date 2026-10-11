import mongoose from 'mongoose';
import { ALL_MACHINE_STATUSES, MACHINE_EVENT_TYPES, MAINTENANCE_CATEGORIES, PROBLEM_CATEGORIES, PROBLEM_SEVERITIES } from '../constants/machines.js';
import { appendOnly } from './plugins/appendOnly.js';

const { Schema } = mongoose;

/**
 * A machine's history (Phase 7), append-only: status changes, problems and their resolution,
 * maintenance. A problem is open until a PROBLEM_RESOLVED event references it (resolvesEventId,
 * unique, so it cannot be resolved twice). Downtime of a critical problem =
 * reported.occurredAt -> resolved.occurredAt.
 */
const problemSchema = new Schema(
  {
    category: { type: String, required: true, enum: PROBLEM_CATEGORIES },
    severity: { type: String, required: true, enum: PROBLEM_SEVERITIES },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    estimatedDowntimeMinutes: { type: Number, min: 0, default: null },
  },
  { _id: false },
);

const machineEventSchema = new Schema(
  {
    machineId: { type: Schema.Types.ObjectId, ref: 'Machine', required: true },
    runId: { type: Schema.Types.ObjectId, ref: 'ProductionRun', default: null },
    type: { type: String, required: true, enum: MACHINE_EVENT_TYPES },
    fromStatus: { type: String, enum: [...ALL_MACHINE_STATUSES, null], default: null },
    toStatus: { type: String, enum: [...ALL_MACHINE_STATUSES, null], default: null },
    problem: { type: problemSchema, default: null },
    resolvesEventId: { type: Schema.Types.ObjectId, ref: 'MachineEvent', default: null },
    note: { type: String, trim: true, maxlength: 1000, default: null },
    // MAINTENANCE_ENDED only: what the maintenance cost (integer paise), recorded once when it finishes.
    costPaise: { type: Number, min: 0, default: null, validate: { validator: (v) => v === null || Number.isInteger(v), message: 'costPaise must be an integer' } },
    // MAINTENANCE_ENDED: kind of work, supplier/bill reference, and the downtime since it started.
    maintenanceCategory: { type: String, enum: [...MAINTENANCE_CATEGORIES, null], default: null },
    reference: { type: String, trim: true, maxlength: 60, default: null },
    downtimeMinutes: { type: Number, min: 0, default: null },
    // MAINTENANCE_COST_CORRECTED: the MAINTENANCE_ENDED event whose cost it corrects (several allowed).
    correctsEventId: { type: Schema.Types.ObjectId, ref: 'MachineEvent', default: null },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorRole: { type: String, required: true },
    occurredAt: { type: Date, default: () => new Date() },
    source: { type: String, enum: ['ONLINE', 'OFFLINE'], default: 'ONLINE' },
  },
  { versionKey: false },
);

machineEventSchema.index({ machineId: 1, occurredAt: -1 });
machineEventSchema.index({ correctsEventId: 1, occurredAt: -1 }, { partialFilterExpression: { correctsEventId: { $type: 'objectId' } } });
// A problem can be resolved once: a second resolution collides here.
machineEventSchema.index(
  { resolvesEventId: 1 },
  { unique: true, partialFilterExpression: { resolvesEventId: { $type: 'objectId' } } },
);

machineEventSchema.plugin(appendOnly, { collectionLabel: 'machineEvents' });

export function toPublicMachineEvent(event, { resolvedBy } = {}) {
  return {
    id: String(event._id),
    machineId: String(event.machineId),
    runId: event.runId ? String(event.runId) : null,
    type: event.type,
    fromStatus: event.fromStatus ?? null,
    toStatus: event.toStatus ?? null,
    problem: event.problem
      ? {
          category: event.problem.category,
          severity: event.problem.severity,
          description: event.problem.description,
          estimatedDowntimeMinutes: event.problem.estimatedDowntimeMinutes ?? null,
        }
      : null,
    resolvesEventId: event.resolvesEventId ? String(event.resolvesEventId) : null,
    note: event.note ?? null,
    costPaise: event.costPaise ?? null,
    maintenanceCategory: event.maintenanceCategory ?? null,
    reference: event.reference ?? null,
    downtimeMinutes: event.downtimeMinutes ?? null,
    correctsEventId: event.correctsEventId ? String(event.correctsEventId) : null,
    actorId: String(event.actorId),
    actorRole: event.actorRole,
    occurredAt: event.occurredAt,
    ...(resolvedBy !== undefined ? { resolution: resolvedBy } : {}),
  };
}

export const MachineEvent = mongoose.model('MachineEvent', machineEventSchema);
