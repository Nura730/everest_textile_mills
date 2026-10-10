// The full order lifecycle (docs/DATABASE.md). Every status exists from day one so the model never
// changes shape; each phase only adds the transitions it implements to ALLOWED_TRANSITIONS.
export const ORDER_STATUS = Object.freeze({
  ORDER_CREATED: 'ORDER_CREATED',
  CONFIRMED: 'CONFIRMED',
  REJECTED: 'REJECTED',
  MATERIAL_RESERVED: 'MATERIAL_RESERVED',
  IN_PRODUCTION: 'IN_PRODUCTION',
  PRODUCTION_COMPLETED: 'PRODUCTION_COMPLETED',
  READY_FOR_DISPATCH: 'READY_FOR_DISPATCH',
  DISPATCHED: 'DISPATCHED',
  INVOICED: 'INVOICED',
  CANCELLED: 'CANCELLED',
});

export const ALL_ORDER_STATUSES = Object.freeze(Object.values(ORDER_STATUS));

/**
 * from → the statuses it may move to. Anything not listed is an invalid transition (409).
 * Phase 5: only cancelling or rejecting a freshly created order.
 * Phase 6 adds ORDER_CREATED → CONFIRMED (after the feasibility check), Phase 4 the reservation
 * step, and so on.
 */
const ALLOWED_TRANSITIONS = Object.freeze({
  [ORDER_STATUS.ORDER_CREATED]: Object.freeze([ORDER_STATUS.CANCELLED, ORDER_STATUS.REJECTED]),
});

export function allowedNextStatuses(from) {
  return ALLOWED_TRANSITIONS[from] ?? [];
}

export function canTransition(from, to) {
  return allowedNextStatuses(from).includes(to);
}
