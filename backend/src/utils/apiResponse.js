/**
 * Success envelope: { success: true, data, meta? }
 * 204 is not allowed because it cannot carry the envelope.
 */
export function sendSuccess(res, data, { status = 200, meta } = {}) {
  if (!Number.isInteger(status) || status < 200 || status > 299 || status === 204) {
    throw new TypeError(`sendSuccess requires a 2xx status with a body, got ${status}`);
  }
  const body = { success: true, data: data ?? null };
  if (meta !== undefined) body.meta = meta;
  return res.status(status).json(body);
}

/**
 * Error envelope: { success: false, error: { code, message, details?, requestId } }
 * Expects an AppError (or anything with code/status/message); the error handler normalizes first.
 */
export function sendError(res, error, requestId) {
  const body = {
    success: false,
    error: { code: error.code, message: error.message, requestId },
  };
  if (error.details !== undefined) body.error.details = error.details;
  return res.status(error.status).json(body);
}
