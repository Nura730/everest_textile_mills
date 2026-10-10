import mongoose from 'mongoose';

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

// ── Append-only ────────────────────────────────────────────────────────────────
// History is evidence. Through this model, an entry can be created and read, nothing else.
// (A determined DBA can still edit the collection; in production the app's database user would
// get insert/find privileges only on auditLogs. See docs/DATABASE.md.)
function rejectMutation() {
  throw new Error('auditLogs is append-only: entries cannot be updated or deleted');
}

const MUTATING_QUERIES = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
];
auditLogSchema.pre(MUTATING_QUERIES, { query: true, document: false }, rejectMutation);
auditLogSchema.pre('deleteOne', { query: false, document: true }, rejectMutation);
auditLogSchema.pre('save', function rejectResave() {
  if (!this.isNew) rejectMutation();
});
auditLogSchema.pre('bulkWrite', rejectMutation);

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
