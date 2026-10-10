import mongoose from 'mongoose';
import { appendOnly } from './plugins/appendOnly.js';

const { Schema } = mongoose;

export const SYNC_OUTCOME = Object.freeze({
  APPLIED: 'APPLIED', // the action was carried out
  DUPLICATE: 'DUPLICATE', // this eventId was already processed; the stored outcome is returned
  CONFLICT: 'CONFLICT', // the factory moved on while the device was offline (e.g. the run was already paused)
  REJECTED: 'REJECTED', // never valid (bad data, not allowed for this role, unknown record)
});

/**
 * Phase 15: one action captured on a device while offline and replayed on reconnect. The outcome
 * of an eventId is decided once and never changes; resending it returns the same outcome.
 * Append-only, so the log doubles as the device's sync history.
 */
const syncEventSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true },
    deviceId: { type: String, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorRole: { type: String, required: true },
    type: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: null },
    recordedAt: { type: Date, required: true }, // on the device
    receivedAt: { type: Date, default: () => new Date() },
    outcome: { type: String, enum: Object.values(SYNC_OUTCOME), required: true },
    result: { type: Schema.Types.Mixed, default: null },
    error: { code: { type: String, default: null }, message: { type: String, default: null } },
  },
  { versionKey: false },
);
syncEventSchema.index({ actorId: 1, receivedAt: -1 });
syncEventSchema.plugin(appendOnly, { collectionLabel: 'syncEvents' });

export const SyncEvent = mongoose.model('SyncEvent', syncEventSchema);
