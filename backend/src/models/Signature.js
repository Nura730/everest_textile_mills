import mongoose from 'mongoose';
import { SIGNATURE_ENTITY } from '../constants/quality.js';
import { appendOnly } from './plugins/appendOnly.js';

const { Schema } = mongoose;

/**
 * A person formally taking responsibility for one business event (instruction.md §11): QC approval
 * of a roll, or final dispatch. Stores the exact statement agreed to, a SHA-256 hash of the canonical
 * signed record (so a later change to the record is detectable), and the drawn signature image.
 * One signature per event; append-only.
 */
const signatureSchema = new Schema(
  {
    signerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    signerName: { type: String, required: true },
    signerRole: { type: String, required: true },
    entityType: { type: String, required: true, enum: Object.values(SIGNATURE_ENTITY) },
    entityId: { type: Schema.Types.ObjectId, required: true },
    statement: { type: String, required: true },
    contentHash: { type: String, required: true },
    signatureImage: { type: String, required: true },
    signedAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);

signatureSchema.index({ entityType: 1, entityId: 1 }, { unique: true });
signatureSchema.plugin(appendOnly, { collectionLabel: 'signatures' });

export function toPublicSignature(signature, { includeImage = false } = {}) {
  return {
    id: String(signature._id),
    signerName: signature.signerName,
    signerRole: signature.signerRole,
    entityType: signature.entityType,
    entityId: String(signature.entityId),
    statement: signature.statement,
    contentHash: signature.contentHash,
    signedAt: signature.signedAt,
    ...(includeImage ? { signatureImage: signature.signatureImage } : {}),
  };
}

export const Signature = mongoose.model('Signature', signatureSchema);
