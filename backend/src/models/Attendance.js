import mongoose from 'mongoose';
import { ATTENDANCE_STATUS, DEPARTMENTS, WAGE_BASIS } from '../constants/workforce.js';

const { Schema } = mongoose;
const integer = { validator: (v) => v === null || Number.isInteger(v), message: '{PATH} must be an integer' };

const entryState = new Schema(
  { status: { type: String, enum: Object.values(ATTENDANCE_STATUS) }, minutes: { type: Number, default: null }, wagePaise: { type: Number } },
  { _id: false },
);

/**
 * One worker's attendance on one Indian calendar day (unique per worker and date: a second entry for the
 * same day is refused, never merged). The wage is computed by the server from the worker's terms at the
 * time (snapshotted here: basis, rate, half-day factor). A correction changes the entry and appends the
 * before/after with its reason and author to `corrections` (and the audit log); nothing is deleted.
 */
const attendanceSchema = new Schema(
  {
    workerId: { type: Schema.Types.ObjectId, ref: 'Worker', required: true },
    workerCode: { type: String, required: true },
    workerName: { type: String, required: true },
    department: { type: String, required: true, enum: DEPARTMENTS },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // "YYYY-MM-DD", India
    status: { type: String, required: true, enum: Object.values(ATTENDANCE_STATUS) },
    // HOURLY workers: minutes worked (null for daily-rated workers and for absences).
    minutes: { type: Number, default: null, min: 0, validate: integer },
    wageBasis: { type: String, required: true, enum: Object.values(WAGE_BASIS) },
    ratePaise: { type: Number, required: true, min: 0, validate: integer },
    halfDayFactorBp: { type: Number, required: true, min: 0, max: 10_000, validate: integer },
    wagePaise: { type: Number, required: true, min: 0, validate: integer },
    note: { type: String, trim: true, maxlength: 500, default: null },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    recordedByRole: { type: String, required: true },
    source: { type: String, enum: ['ONLINE', 'OFFLINE'], default: 'ONLINE' },
    corrections: {
      type: [
        {
          at: { type: Date, required: true },
          by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
          byRole: { type: String, required: true },
          reason: { type: String, required: true, maxlength: 500 },
          before: entryState,
          after: entryState,
          _id: false,
        },
      ],
      default: [],
    },
  },
  { timestamps: true },
);
attendanceSchema.index({ workerId: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1, department: 1 });

const hours = (minutes) => (minutes === null || minutes === undefined ? null : Math.round((minutes / 60) * 100) / 100);

/** Wages (and rates) only for callers allowed to see them. */
export function toPublicAttendance(a, { includeWages = false } = {}) {
  return {
    id: String(a._id),
    workerId: String(a.workerId),
    workerCode: a.workerCode,
    workerName: a.workerName,
    department: a.department,
    date: a.date,
    status: a.status,
    hours: hours(a.minutes),
    wageBasis: a.wageBasis,
    ...(includeWages ? { ratePaise: a.ratePaise, halfDayFactorBp: a.halfDayFactorBp, wagePaise: a.wagePaise } : {}),
    note: a.note ?? null,
    recordedByRole: a.recordedByRole,
    source: a.source,
    corrections: (a.corrections ?? []).map((c) => ({
      at: c.at,
      byRole: c.byRole,
      reason: c.reason,
      before: { status: c.before?.status, hours: hours(c.before?.minutes), ...(includeWages ? { wagePaise: c.before?.wagePaise } : {}) },
      after: { status: c.after?.status, hours: hours(c.after?.minutes), ...(includeWages ? { wagePaise: c.after?.wagePaise } : {}) },
    })),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export const Attendance = mongoose.model('Attendance', attendanceSchema);
