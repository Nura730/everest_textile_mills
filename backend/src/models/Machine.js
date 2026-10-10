import mongoose from 'mongoose';
import { ALL_MACHINE_STATUSES, MACHINE_STATUS } from '../constants/machines.js';
import { MACHINE_TYPES } from '../constants/production.js';
import { cmToMetres } from '../utils/units.js';

const { Schema } = mongoose;

const integer = { validator: Number.isInteger, message: '{PATH} must be an integer' };

/**
 * A machine on the floor (Phase 7). `status` only changes through guarded updates in
 * machine.service (each change also appends a MachineEvent). `statusBeforeDown` remembers where a
 * machine was when a critical problem took it DOWN, so repair can put it back.
 * Retired, never deleted (`isActive: false`): its history stays.
 */
const machineSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, unique: true, maxlength: 20 },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
    type: { type: String, required: true, enum: MACHINE_TYPES },
    // Rated output in integer centimetres per hour (the API speaks metres per hour).
    ratedCmPerHour: { type: Number, required: true, min: 1, validate: integer },
    location: { type: String, trim: true, maxlength: 100, default: null },
    status: { type: String, required: true, enum: ALL_MACHINE_STATUSES, default: MACHINE_STATUS.AVAILABLE },
    statusBeforeDown: { type: String, enum: [...ALL_MACHINE_STATUSES, null], default: null },
    statusChangedAt: { type: Date, default: () => new Date() },
    currentRunId: { type: Schema.Types.ObjectId, ref: 'ProductionRun', default: null },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// The floor view: machines of a type by status.
machineSchema.index({ isActive: 1, type: 1, status: 1 });

export function toPublicMachine(machine) {
  return {
    id: String(machine._id),
    code: machine.code,
    name: machine.name,
    type: machine.type,
    ratedMetresPerHour: cmToMetres(machine.ratedCmPerHour),
    location: machine.location ?? null,
    status: machine.status,
    statusChangedAt: machine.statusChangedAt,
    currentRunId: machine.currentRunId ? String(machine.currentRunId) : null,
    isActive: machine.isActive,
    createdAt: machine.createdAt,
    updatedAt: machine.updatedAt,
  };
}

export const Machine = mongoose.model('Machine', machineSchema);
