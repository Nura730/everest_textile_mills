import { getDbStatus } from '../config/db.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess } from '../utils/apiResponse.js';

// Readiness check: 200 only when the API can actually serve data.
export function getHealth(req, res) {
  const db = getDbStatus();
  if (db !== 'connected') {
    throw new AppError('SERVICE_UNAVAILABLE', 'Database is not connected', { details: { db } });
  }
  return sendSuccess(res, { status: 'ok', db, uptimeSeconds: Math.round(process.uptime()) });
}
