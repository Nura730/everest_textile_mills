import { ERROR_CODES, isKnownErrorCode } from './errorCodes.js';

/**
 * An expected, client-facing failure. Services throw it; the error handler renders it.
 * Services choose the business code; the HTTP status is derived from it, never chosen ad hoc.
 */
export class AppError extends Error {
  constructor(code, message, { details, cause } = {}) {
    if (!isKnownErrorCode(code)) {
      // Fail loudly in development/tests rather than silently returning a 500.
      throw new TypeError(`Unknown error code: ${code}`);
    }
    super(message, cause ? { cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = details;
    this.isOperational = true;
  }
}
