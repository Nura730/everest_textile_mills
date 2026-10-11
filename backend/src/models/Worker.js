import mongoose from 'mongoose';
import { DEPARTMENTS, WAGE_BASIS } from '../constants/workforce.js';

const { Schema } = mongoose;
const integer = { validator: Number.isInteger, message: '{PATH} must be an integer' };

/**
 * A factory worker (labour register), not a system user. Wage basis and rate are the current terms;
 * each attendance record keeps a copy of the terms it was paid at, so a rate change never rewrites
 * wages already recorded. Workers are deactivated, never deleted (their attendance stays).
 */
const workerSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, unique: true, maxlength: 20 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    department: { type: String, required: true, enum: DEPARTMENTS },
    wageBasis: { type: String, required: true, enum: Object.values(WAGE_BASIS) },
    // DAILY: paise per full day; HOURLY: paise per hour.
    ratePaise: { type: Number, required: true, min: 0, validate: integer },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);
workerSchema.index({ isActive: 1, department: 1, name: 1 });

/** Wage terms are money: only callers allowed to see wages get them. */
export function toPublicWorker(worker, { includeWages = false } = {}) {
  return {
    id: String(worker._id),
    code: worker.code,
    name: worker.name,
    department: worker.department,
    wageBasis: worker.wageBasis,
    ...(includeWages ? { ratePaise: worker.ratePaise } : {}),
    isActive: worker.isActive,
    createdAt: worker.createdAt,
    updatedAt: worker.updatedAt,
  };
}

export const Worker = mongoose.model('Worker', workerSchema);
