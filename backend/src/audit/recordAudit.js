import { AuditLog } from '../models/AuditLog.js';

/**
 * Appends one audit entry. Always pass the business transaction's session: the audit entry must
 * commit or roll back together with the change it describes, so history can never claim
 * something happened that did not (or miss something that did).
 *
 * context = { actor: req.user, requestId, idempotencyKey, source }
 */
export async function recordAudit(
  { action, entityType, entityId, orderId = null, machineId = null, before = null, after = null, correctsAuditId = null },
  context,
  session,
) {
  if (!session) {
    throw new Error('recordAudit requires the business transaction session');
  }
  const [entry] = await AuditLog.create(
    [
      {
        action,
        actorId: context.actor.id,
        actorRole: context.actor.role,
        entityType,
        entityId,
        orderId,
        machineId,
        before,
        after,
        correctsAuditId,
        source: context.source ?? 'ONLINE',
        requestId: context.requestId ?? null,
        idempotencyKey: context.idempotencyKey ?? null,
      },
    ],
    { session },
  );
  return entry;
}
