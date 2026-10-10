import mongoose from 'mongoose';
import { SIGNATURE_ENTITY } from '../constants/quality.js';
import { appendOnly } from './plugins/appendOnly.js';

const { Schema } = mongoose;

/**
 * A signed approval of one business event: a QC inspection (pass, rework or reject) or a final
 * dispatch. Since the cryptographic upgrade each signature holds the canonical signed payload, its
 * SHA-256 hash, an RSA-PSS/SHA-256 signature made with the signer's own key (keyId), and a one-time
 * nonce. The drawn image, when present, is only a handwritten acknowledgment, not cryptographic proof.
 * Older signatures (before the upgrade) have only contentHash + image. One signature per event;
 * append-only.
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
    signatureImage: { type: String, default: null }, // optional handwritten acknowledgment
    // Cryptographic signature (absent on records made before the upgrade)
    algorithm: { type: String, default: null },
    keyId: { type: String, default: null },
    payload: { type: String, default: null }, // canonical JSON that was signed
    payloadHash: { type: String, default: null }, // SHA-256 hex of payload
    signatureValue: { type: String, default: null }, // base64
    nonce: { type: String, default: null },
    signedAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);

signatureSchema.index({ entityType: 1, entityId: 1 }, { unique: true });
// One signed approval per nonce: a captured request cannot be replayed into a second signature.
signatureSchema.index({ nonce: 1 }, { unique: true, partialFilterExpression: { nonce: { $type: 'string' } } });
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
    algorithm: signature.algorithm ?? null,
    keyId: signature.keyId ?? null,
    payloadHash: signature.payloadHash ?? null,
    cryptographic: Boolean(signature.signatureValue),
    hasHandwrittenAcknowledgment: Boolean(signature.signatureImage),
    ...(includeImage && signature.signatureImage ? { signatureImage: signature.signatureImage } : {}),
  };
}

export const Signature = mongoose.model('Signature', signatureSchema);
