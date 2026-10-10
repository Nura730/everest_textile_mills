import mongoose from 'mongoose';
import { appendOnly } from './plugins/appendOnly.js';

const { Schema } = mongoose;

export const AUDIT_SOURCES = Object.freeze(['ONLINE', 'OFFLINE']);

const auditLogSchema = new Schema(
  {
    action: { type: String, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    actorRole: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
    orderId: { type: Schema.Types.ObjectId, default: null },
    machineId: { type: Schema.Types.ObjectId, default: null },
    before: { type: Schema.Types.Mixed, default: null },
    after: { type: Schema.Types.Mixed, default: null },
    source: { type: String, enum: AUDIT_SOURCES, default: 'ONLINE' },
    requestId: { type: String, default: null },
    idempotencyKey: { type: String, default: null },
    // A correction is a NEW entry pointing at the entry it corrects; the original is never changed.
    correctsAuditId: { type: Schema.Types.ObjectId, ref: 'AuditLog', default: null },
    at: { type: Date, default: () => new Date(), required: true },
  },
  { versionKey: false },
);

auditLogSchema.index({ entityType: 1, entityId: 1, at: 1 });
auditLogSchema.index({ orderId: 1, at: 1 });
auditLogSchema.index({ actorId: 1, at: 1 });
auditLogSchema.index({ action: 1, at: 1 });

// History is evidence: through this model an entry can be created and read, nothing else.
auditLogSchema.plugin(appendOnly, { collectionLabel: 'auditLogs' });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
