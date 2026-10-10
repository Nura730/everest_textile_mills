import mongoose from 'mongoose';

const { Schema } = mongoose;

export const SIGNING_KEY_STATUS = Object.freeze({ ACTIVE: 'ACTIVE', REVOKED: 'REVOKED' });

/**
 * One user's RSA signing key pair (managed keys). The key is generated on the server for that user;
 * the private key is stored only encrypted (AES-256-GCM with the server's key-encryption key,
 * SIGNING_KEY_ENCRYPTION_KEY) and is never sent anywhere. The public key is stored in clear so any
 * signature can be verified, also after the key is rotated (status REVOKED: no new signatures).
 * At most one ACTIVE key per user.
 */
const signingKeySchema = new Schema(
  {
    keyId: { type: String, required: true, unique: true }, // first 16 hex of SHA-256(SPKI DER)
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    algorithm: { type: String, required: true, default: 'RSA-PSS-SHA256' },
    modulusBits: { type: Number, required: true },
    publicKeyPem: { type: String, required: true },
    encryptedPrivateKey: {
      iv: { type: String, required: true },
      tag: { type: String, required: true },
      ciphertext: { type: String, required: true },
      kekId: { type: String, required: true }, // which key-encryption key sealed it
    },
    status: { type: String, enum: Object.values(SIGNING_KEY_STATUS), default: SIGNING_KEY_STATUS.ACTIVE },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
  },
  { timestamps: true, versionKey: false },
);
signingKeySchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { status: SIGNING_KEY_STATUS.ACTIVE } });

export function toPublicSigningKey(key) {
  return {
    keyId: key.keyId,
    userId: String(key.userId),
    algorithm: key.algorithm,
    modulusBits: key.modulusBits,
    publicKeyPem: key.publicKeyPem,
    status: key.status,
    createdAt: key.createdAt,
    revokedAt: key.revokedAt,
  };
}

export const SigningKey = mongoose.model('SigningKey', signingKeySchema);
