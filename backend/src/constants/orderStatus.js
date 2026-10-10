// The full order lifecycle (docs/DATABASE.md). Every status exists from day one so the model never
// changes shape; each phase only adds the transitions it implements to ALLOWED_TRANSITIONS.
export const ORDER_STATUS = Object.freeze({
  ORDER_CREATED: "ORDER_CREATED",
  CONFIRMED: "CONFIRMED",
  REJECTED: "REJECTED",
  MATERIAL_RESERVED: "MATERIAL_RESERVED",
  IN_PRODUCTION: "IN_PRODUCTION",
  PRODUCTION_COMPLETED: "PRODUCTION_COMPLETED",
  READY_FOR_DISPATCH: "READY_FOR_DISPATCH",
  DISPATCHED: "DISPATCHED",
  INVOICED: "INVOICED",
  CANCELLED: "CANCELLED",
});

export const ALL_ORDER_STATUSES = Object.freeze(Object.values(ORDER_STATUS));

/**
 * Statuses in which an order still owes the buyer a delivery, so a passed deadline makes it
 * overdue. Cancelled and rejected orders are closed; dispatched and invoiced ones were delivered.
 */
export const DELIVERY_PENDING_STATUSES = Object.freeze([
  ORDER_STATUS.ORDER_CREATED,
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.MATERIAL_RESERVED,
  ORDER_STATUS.IN_PRODUCTION,
  ORDER_STATUS.PRODUCTION_COMPLETED,
  ORDER_STATUS.READY_FOR_DISPATCH,
]);

/**
 * from → the statuses it may move to. Anything not listed is an invalid transition (409).
 * Phase 5: cancelling or rejecting a freshly created order.
 * Phase 6: ORDER_CREATED → CONFIRMED (only after a passing feasibility check), and a confirmed
 * order can still be cancelled (it holds no reservations yet). Phase 4 adds the reservation step,
 * and so on.
 */
const ALLOWED_TRANSITIONS = Object.freeze({
  [ORDER_STATUS.ORDER_CREATED]: Object.freeze([
    ORDER_STATUS.CONFIRMED,
    ORDER_STATUS.CANCELLED,
    ORDER_STATUS.REJECTED,
  ]),
  [ORDER_STATUS.CONFIRMED]: Object.freeze([ORDER_STATUS.CANCELLED]),
});

export function allowedNextStatuses(from) {
  return ALLOWED_TRANSITIONS[from] ?? [];
}

export function canTransition(from, to) {
  return allowedNextStatuses(from).includes(to);
}
