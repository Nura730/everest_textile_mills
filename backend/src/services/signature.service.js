import { createHash } from 'node:crypto';
import { Signature } from '../models/Signature.js';
import { canonicalJson } from './idempotency.service.js';

/**
 * Signs one business event inside its transaction. The content hash covers the statement, the
 * signer and the canonical signed record, so anyone can later recompute it from the stored record
 * and see whether the record still says what was signed.
 */
export function signatureHash({ statement, signerId, record }) {
  return createHash('sha256').update(canonicalJson({ statement, signerId: String(signerId), record })).digest('hex');
}

export async function createSignature({ entityType, entityId, statement, record, image }, context, session) {
  const [signature] = await Signature.create(
    [
      {
        signerId: context.actor.id,
        signerName: context.actor.name,
        signerRole: context.actor.role,
        entityType,
        entityId,
        statement,
        contentHash: signatureHash({ statement, signerId: context.actor.id, record }),
        signatureImage: image,
      },
    ],
    { session },
  );
  return signature.toObject();
}

export function findSignature(entityType, entityId) {
  return Signature.findOne({ entityType, entityId }).lean();
}
