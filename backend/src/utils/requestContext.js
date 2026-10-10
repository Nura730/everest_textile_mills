/**
 * What a service needs to know about the caller, without depending on Express.
 * The same shape is built by the offline sync endpoint (Phase 15) with source 'OFFLINE',
 * which is why services take a context instead of `req`.
 */
export function requestContext(req) {
  return {
    actor: req.user,
    requestId: req.id ?? null,
    idempotencyKey: req.idempotencyKey ?? null,
    source: 'ONLINE',
  };
}
