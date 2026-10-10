import mongoose from 'mongoose';

const { Schema } = mongoose;

const idempotencyRecordSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    key: { type: String, required: true },
    operation: { type: String, required: true },
    // SHA-256 of the canonical request: detects the same key being reused for a different request.
    requestHash: { type: String, required: true },
    // null while the transaction that owns this record is still running.
    statusCode: { type: Number, default: null },
    responseBody: { type: Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);

// Scoped per actor: one user's key can never replay (and leak) another user's response.
// No TTL on purpose (docs/DATABASE.md D8): offline devices may retry very late.
idempotencyRecordSchema.index({ actorId: 1, key: 1 }, { unique: true });

export const IdempotencyRecord = mongoose.model('IdempotencyRecord', idempotencyRecordSchema);
