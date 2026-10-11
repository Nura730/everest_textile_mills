import { Signature } from '../models/Signature.js';

// Approvals are signed in signing.service.js (RSA-PSS with the signer's own key). This module only
// looks signatures up.
export function findSignature(entityType, entityId) {
  return Signature.findOne({ entityType, entityId }).lean();
}

export function findSignaturesByIds(ids) {
  return Signature.find({ _id: { $in: ids } }).lean();
}
