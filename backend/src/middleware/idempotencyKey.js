import { AppError } from '../utils/AppError.js';

export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
// Same shape as request ids: the frontend can use a UUID, the offline queue its event id.
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Every mutating stock, production and sync endpoint requires a client-generated key, so a retry
 * after a timeout can never apply the same change twice. Sets req.idempotencyKey.
 */
export function requireIdempotencyKey(req, res, next) {
  const key = req.get(IDEMPOTENCY_KEY_HEADER);
  if (typeof key !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new AppError('VALIDATION_ERROR', `A valid ${IDEMPOTENCY_KEY_HEADER} header is required`, {
      details: [
        {
          location: 'headers',
          path: IDEMPOTENCY_KEY_HEADER,
          message: 'must be 8-64 characters: letters, digits and hyphens (a UUID works)',
        },
      ],
    });
  }
  req.idempotencyKey = key;
  return next();
}
