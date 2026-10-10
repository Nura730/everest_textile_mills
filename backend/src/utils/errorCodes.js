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
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  DUPLICATE_RESOURCE: 409,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
});

export function isKnownErrorCode(code) {
  return Object.hasOwn(ERROR_CODES, code);
}
