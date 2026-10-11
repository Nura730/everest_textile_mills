/**
 * Which delivery steps a role can take on a dispatch now (mirrors the server rules; the server decides).
 *   buyer: confirm receipt while in transit; report a problem until the admin has verified
 *   admin: confirm on the buyer's behalf (with proof) while in transit; verify a confirmed or disputed delivery
 * Other roles have no delivery step.
 */
export function deliveryActionsFor(role, dispatch) {
  const status = dispatch.delivery?.status;
  if (!status) return [];
  if (role === 'BUYER') return [...(status === 'IN_TRANSIT' ? ['confirm'] : []), ...(['IN_TRANSIT', 'DELIVERED'].includes(status) ? ['discrepancy'] : [])];
  if (role === 'ADMIN') return [...(status === 'IN_TRANSIT' ? ['confirm'] : []), ...(['DELIVERED', 'DISCREPANCY'].includes(status) ? ['verify'] : [])];
  return [];
}
