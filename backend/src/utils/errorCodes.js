// Single source of truth: every error code the API can return, and its HTTP status.
// 400 = the request itself is wrong.
// 409 = the request is well-formed but conflicts with current factory state.
// Domain codes (INSUFFICIENT_STOCK, INVALID_STATE_TRANSITION, ...) are added in their phase.
export const ERROR_CODES = Object.freeze({
  VALIDATION_ERROR: 400,
  INVALID_JSON: 400,
  UNAUTHENTICATED: 401,
  // Only for a genuinely signed token past its exp; forged tokens get UNAUTHENTICATED.
  TOKEN_EXPIRED: 401,
  // Login only. One code for unknown email, wrong password and deactivated account.
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE_RESOURCE: 409,
  // Same Idempotency-Key sent with a different request.
  IDEMPOTENCY_KEY_REUSED: 409,
  // Inventory
  INSUFFICIENT_STOCK: 409,
  // Lifecycles: the requested status change is not allowed from the current status.
  INVALID_STATE_TRANSITION: 409,
  // Orders
  BUYER_INACTIVE: 409,
  PRODUCT_INACTIVE: 409,
  // The feasibility check failed, so the order cannot be confirmed; details carry the checks.
  ORDER_NOT_FEASIBLE: 409,
  // The order's status no longer allows editing (only ORDER_CREATED orders can be edited).
  ORDER_NOT_EDITABLE: 409,
  // A return of more yarn than the order has on the production floor.
  QUANTITY_EXCEEDS_ISSUED: 409,
  // Machines
  MACHINE_INACTIVE: 409,
  // Production runs
  YARN_NOT_ISSUED: 409,
  NO_OUTPUT_RECORDED: 409,
  QUANTITY_EXCEEDS_ORDER: 409,
  // Quality: a PASS without the inspector's signature (the request is incomplete).
  SIGNATURE_REQUIRED: 400,
  PROBLEM_ALREADY_RESOLVED: 409,
  // Users
  CANNOT_DEACTIVATE_SELF: 409,
  LAST_ACTIVE_ADMIN: 409,
  PAYLOAD_TOO_LARGE: 413,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
});

export function isKnownErrorCode(code) {
  return Object.hasOwn(ERROR_CODES, code);
}
