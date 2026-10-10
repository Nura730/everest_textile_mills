import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, generateKeyPair, randomBytes, sign, verify, constants } from 'node:crypto';
import { promisify } from 'node:util';
import mongoose from 'mongoose';
import { recordAudit } from '../audit/recordAudit.js';
import { getConfig } from '../config/env.js';
import { SIGNATURE_ENTITY } from '../constants/quality.js';
import { Dispatch } from '../models/Fulfilment.js';
import { QcInspection } from '../models/QcInspection.js';
import { Roll } from '../models/Roll.js';
import { Signature } from '../models/Signature.js';
import { SIGNING_KEY_STATUS, SigningKey, toPublicSigningKey } from '../models/SigningKey.js';
import { AppError } from '../utils/AppError.js';
import { runInTransaction } from '../utils/transaction.js';
import { canonicalJson } from './idempotency.service.js';

/*
 * Cryptographic signing of approvals (QC inspections, dispatch confirmation).
 *
 * What a signature proves, and what it does not:
 * - Authentication (JWT, re-checked against the database on every request) establishes WHICH account
 *   is acting; authorization (role + the business rule for this record) establishes that the account
 *   may approve it.
 * - Each user has their own RSA key pair, generated and kept on the server (managed keys: the private
 *   key is stored only encrypted and is never sent to the browser). The server signs on behalf of the
 *   authenticated user with THAT user's key, so a signature binds the approval to the account and key.
 * - The signed payload (canonical JSON) contains the exact business record (ids, result, defects,
 *   quantities), the statement, the signer, the key id, the time and a one-time nonce. Changing the
 *   record, the payload or the signature makes verification fail.
 * - It does not prove the physical identity of the person at the keyboard: that rests on account
 *   security (passwords, sessions). Keys held on the server also mean the server operator could sign;
 *   per-device keys would be the next step if that matters (docs/SIGNATURES.md).
 *
 * Scheme: RSASSA-PSS, SHA-256, MGF1(SHA-256), salt 32 bytes; RSA 3072-bit keys by default.
 */

const ALGORITHM = 'RSA-PSS-SHA256';
const PSS = { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 };
const generateKeyPairAsync = promisify(generateKeyPair);
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function keyEncryptionKey() {
  const kek = getConfig().signingKeyEncryptionKey;
  if (!kek) {
    throw new AppError('SIGNING_KEY_UNAVAILABLE', 'Approvals cannot be signed: the server has no signing key-encryption key configured. Contact the administrator.', {
      details: { failedStage: 'SIGNED' },
    });
  }
  return kek;
}
const kekId = (kek) => sha256(kek).slice(0, 12);

function sealPrivateKey(pem) {
  const kek = keyEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', kek, iv);
  const ciphertext = Buffer.concat([cipher.update(pem, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64'), kekId: kekId(kek) };
}

function openPrivateKey(sealed) {
  const kek = keyEncryptionKey();
  if (sealed.kekId !== kekId(kek)) {
    throw new AppError('SIGNING_KEY_UNAVAILABLE', 'Your signing key cannot be opened with the current server key. Contact the administrator to issue a new signing key.', {
      details: { failedStage: 'SIGNED' },
    });
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', kek, Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    const pem = Buffer.concat([decipher.update(Buffer.from(sealed.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    return createPrivateKey(pem);
  } catch {
    throw new AppError('SIGNING_KEY_UNAVAILABLE', 'Your signing key could not be opened. Contact the administrator.', { details: { failedStage: 'SIGNED' } });
  }
}

/** keyId = first 16 hex of SHA-256 over the public key's DER (SPKI). */
export function keyIdOf(publicKeyPem) {
  return sha256(createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })).slice(0, 16);
}

async function createKeyFor(userId, context) {
  keyEncryptionKey(); // fail before the slow generation if signing is not configured
  const { publicKey, privateKey } = await generateKeyPairAsync('rsa', {
    modulusLength: getConfig().signingRsaBits,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const keyId = keyIdOf(publicKey);
  return runInTransaction(async (session) => {
    const [key] = await SigningKey.create(
      [{ keyId, userId, algorithm: ALGORITHM, modulusBits: getConfig().signingRsaBits, publicKeyPem: publicKey, encryptedPrivateKey: sealPrivateKey(privateKey) }],
      { session },
    );
    await recordAudit(
      { action: 'SIGNING_KEY_CREATED', entityType: 'SigningKey', entityId: key._id, after: { keyId, userId: String(userId), algorithm: ALGORITHM, modulusBits: key.modulusBits } },
      context,
      session,
    );
    return key.toObject();
  });
}

/**
 * The user's active signing key, created on first use. Called BEFORE the approval's transaction
 * (key generation is slow and must not hold locks). Two first uses at once: one key wins, both use it.
 */
export async function ensureSigningKey(actor) {
  const existing = await SigningKey.findOne({ userId: actor.id, status: SIGNING_KEY_STATUS.ACTIVE }).lean();
  if (existing) return existing;
  try {
    return await createKeyFor(actor.id, { actor, source: 'ONLINE' });
  } catch (err) {
    if (err?.code === 11000) return SigningKey.findOne({ userId: actor.id, status: SIGNING_KEY_STATUS.ACTIVE }).lean();
    throw err;
  }
}

/** Admin: retire a user's key and issue a new one. Old signatures stay verifiable (public key kept). */
export async function rotateSigningKey(userId, context) {
  await runInTransaction(async (session) => {
    const active = await SigningKey.findOneAndUpdate(
      { userId, status: SIGNING_KEY_STATUS.ACTIVE },
      { $set: { status: SIGNING_KEY_STATUS.REVOKED, revokedAt: new Date(), revokedReason: 'ROTATED' } },
      { session, returnDocument: 'after', lean: true },
    );
    if (active) {
      await recordAudit({ action: 'SIGNING_KEY_REVOKED', entityType: 'SigningKey', entityId: active._id, after: { keyId: active.keyId, userId: String(userId), reason: 'ROTATED' } }, context, session);
    }
  });
  return toPublicSigningKey(await createKeyFor(userId, context));
}

export async function signingKeyOf(userId) {
  const key = await SigningKey.findOne({ userId, status: SIGNING_KEY_STATUS.ACTIVE }).lean();
  return key ? toPublicSigningKey(key) : null;
}

const STAGE_LABELS = {
  AUTHENTICATED: 'Authenticating signer',
  AUTHORIZED: 'Checking permissions',
  PAYLOAD_PREPARED: 'Preparing approval data',
  HASHED: 'Generating payload hash',
  SIGNED: 'Creating RSA signature',
  VERIFIED: 'Verifying signature',
  SAVED: 'Saving signed approval',
};

/** Pure: sign a canonical payload with a private key (PSS/SHA-256). */
export function signPayload(payloadText, privateKey) {
  return sign('sha256', Buffer.from(payloadText, 'utf8'), { key: privateKey, ...PSS }).toString('base64');
}

/** Pure: verify a signature over a canonical payload with a public key. Never throws. */
export function verifyPayload(payloadText, signatureBase64, publicKeyPem) {
  try {
    return verify('sha256', Buffer.from(payloadText, 'utf8'), { key: publicKeyPem, ...PSS }, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}

/**
 * Signs one approval inside its business transaction and returns { signature, signing } where
 * `signing` describes the stages that actually ran. The signature is verified with the public key
 * BEFORE it is stored; if verification fails, nothing of the approval is committed.
 * `nonce` is unique per approval (the request's idempotency key): the same signed approval can never
 * be stored twice (replay), and a resent request replays the stored result instead.
 */
export async function signApproval({ approvalType, entityType, entityId, statement, record, image, nonce }, context, session) {
  const { actor } = context;
  const key = await SigningKey.findOne({ userId: actor.id, status: SIGNING_KEY_STATUS.ACTIVE }).session(session).lean();
  if (!key) {
    throw new AppError('SIGNING_KEY_UNAVAILABLE', 'You have no active signing key. Try again; if it persists, contact the administrator.', { details: { failedStage: 'SIGNED' } });
  }
  const privateKey = openPrivateKey(key.encryptedPrivateKey);

  const signedAt = new Date();
  const payload = canonicalJson({
    v: 1,
    approvalType,
    statement,
    entity: { type: entityType, id: String(entityId) },
    record,
    signer: { id: String(actor.id), name: actor.name, role: actor.role },
    keyId: key.keyId,
    signedAt: signedAt.toISOString(),
    nonce,
  });
  const payloadHash = sha256(payload);
  const signatureValue = signPayload(payload, privateKey);
  if (!verifyPayload(payload, signatureValue, key.publicKeyPem)) {
    // Record the security event outside the (rolled back) business transaction.
    runInTransaction((s) => recordAudit({ action: 'SIGNATURE_VERIFICATION_FAILED', entityType, entityId, after: { approvalType, keyId: key.keyId } }, context, s)).catch(() => {});
    throw new AppError('SIGNATURE_VERIFICATION_FAILED', 'Signature verification failed — approval not confirmed.', { details: { failedStage: 'VERIFIED' } });
  }

  const [signature] = await Signature.create(
    [
      {
        signerId: actor.id,
        signerName: actor.name,
        signerRole: actor.role,
        entityType,
        entityId,
        statement,
        contentHash: payloadHash,
        signatureImage: image ?? null,
        signedAt,
        algorithm: ALGORITHM,
        keyId: key.keyId,
        payload,
        payloadHash,
        signatureValue,
        nonce,
      },
    ],
    { session },
  );

  const done = (stage, detail) => ({ stage, label: STAGE_LABELS[stage], status: 'done', detail });
  return {
    signature: signature.toObject(),
    signing: {
      algorithm: ALGORITHM,
      keyId: key.keyId,
      payloadHash,
      signedAt,
      // Every stage below ran on the server in this request; the response is only sent after the
      // transaction that stores the approval and its signature has committed.
      stages: [
        done('AUTHENTICATED', `Session verified for ${actor.name}`),
        done('AUTHORIZED', `${actor.role} may approve this record`),
        done('PAYLOAD_PREPARED', `${approvalType} for ${entityType} ${String(entityId)}`),
        done('HASHED', `SHA-256 ${payloadHash.slice(0, 16)}…`),
        done('SIGNED', `RSA-PSS with SHA-256, key ${key.keyId}`),
        done('VERIFIED', "Checked with the signer's public key"),
        done('SAVED', 'Stored with the approval in one database transaction'),
      ],
    },
  };
}

/** Public verification metadata for a signature (no secrets). */
export function toSignatureMeta(signature) {
  return {
    id: String(signature._id),
    signerName: signature.signerName,
    signerRole: signature.signerRole,
    entityType: signature.entityType,
    entityId: String(signature.entityId),
    statement: signature.statement,
    signedAt: signature.signedAt,
    algorithm: signature.algorithm ?? null,
    keyId: signature.keyId ?? null,
    payloadHash: signature.payloadHash ?? signature.contentHash,
    cryptographic: Boolean(signature.signatureValue),
    hasHandwrittenAcknowledgment: Boolean(signature.signatureImage),
  };
}

/** The record as it is stored NOW, in the exact shape that was signed. */
async function currentRecordFor(signature) {
  if (signature.entityType === SIGNATURE_ENTITY.QC_INSPECTION) {
    const inspection = await QcInspection.findById(signature.entityId).lean();
    if (!inspection) return null;
    const roll = await Roll.findById(inspection.rollId, { rollNumber: 1, lengthCm: 1 }).lean();
    return qcRecord(inspection, roll);
  }
  if (signature.entityType === SIGNATURE_ENTITY.DISPATCH) {
    const dispatch = await Dispatch.findById(signature.entityId).lean();
    return dispatch ? dispatchRecord(dispatch) : null;
  }
  return null;
}

/** The signed shape of a QC inspection. */
export function qcRecord(inspection, roll) {
  return {
    inspectionId: String(inspection._id),
    rollId: String(inspection.rollId),
    rollNumber: roll?.rollNumber ?? inspection.rollNumber,
    lengthCm: roll?.lengthCm ?? null,
    attempt: inspection.attempt,
    result: inspection.result,
    defects: (inspection.defects ?? []).map((d) => ({ type: d.type, severity: d.severity })),
  };
}

/** The signed shape of a dispatch. */
export function dispatchRecord(dispatch) {
  return {
    dispatchId: String(dispatch._id),
    dispatchNumber: dispatch.dispatchNumber,
    orderNumber: dispatch.orderNumber,
    rolls: dispatch.lines.map((l) => l.rollNumber).sort(),
    totalLengthCm: dispatch.totalLengthCm,
    vehicleNumber: dispatch.vehicleNumber ?? null,
  };
}

/**
 * Independent verification of a stored signature. Every check is reported; `valid` only when all pass:
 * the payload hash matches, the RSA signature verifies with the signer's public key, the key belongs to
 * the signer, and the business record still says exactly what was signed.
 */
export async function verifySignature(signatureId, context) {
  if (!mongoose.isValidObjectId(signatureId)) throw new AppError('NOT_FOUND', 'Signature not found');
  const signature = await Signature.findById(signatureId).lean();
  if (!signature) throw new AppError('NOT_FOUND', 'Signature not found');
  const meta = toSignatureMeta(signature);
  if (!signature.signatureValue) {
    return {
      valid: false,
      kind: 'HANDWRITTEN_ONLY',
      signature: meta,
      checks: [{ check: 'CRYPTOGRAPHIC', ok: false, detail: 'Recorded before cryptographic signing: only a handwritten acknowledgment and a content hash exist.' }],
    };
  }
  const key = await SigningKey.findOne({ keyId: signature.keyId }).lean();
  let payloadRecord = null;
  let payloadSigner = null;
  try {
    const parsed = JSON.parse(signature.payload);
    payloadRecord = parsed.record;
    payloadSigner = parsed.signer;
  } catch {
    // reported by the hash/record checks below
  }
  const current = await currentRecordFor(signature);
  const checks = [
    { check: 'PAYLOAD_HASH', ok: sha256(signature.payload) === signature.payloadHash, detail: 'SHA-256 of the signed payload matches the stored hash' },
    { check: 'RSA_SIGNATURE', ok: Boolean(key) && verifyPayload(signature.payload, signature.signatureValue, key.publicKeyPem), detail: `RSA-PSS signature verifies with public key ${signature.keyId}` },
    { check: 'KEY_OWNER', ok: Boolean(key) && String(key.userId) === String(signature.signerId) && payloadSigner?.id === String(signature.signerId), detail: 'The key belongs to the signer named in the payload' },
    { check: 'RECORD_UNCHANGED', ok: current !== null && canonicalJson(current) === canonicalJson(payloadRecord), detail: 'The business record still says exactly what was signed' },
  ];
  const valid = checks.every((c) => c.ok);
  if (!valid && context) {
    await runInTransaction((s) => recordAudit({ action: 'SIGNATURE_CHECK_FAILED', entityType: signature.entityType, entityId: signature.entityId, after: { signatureId: String(signature._id), failed: checks.filter((c) => !c.ok).map((c) => c.check) } }, context, s)).catch(() => {});
  }
  return { valid, kind: 'CRYPTOGRAPHIC', signature: meta, key: key ? { keyId: key.keyId, status: key.status, modulusBits: key.modulusBits, publicKeyPem: key.publicKeyPem } : null, checks };
}
