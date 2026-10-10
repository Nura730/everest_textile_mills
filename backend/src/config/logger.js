import pino from 'pino';
import { getConfig } from './env.js';

// Credentials must never reach log storage. Authorization carries the JWT from Phase 2.
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
];

export function createLogger({ level, destination } = {}) {
  return pino(
    {
      level,
      base: { service: 'everest-backend' },
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    },
    destination,
  );
}

let logger;

export function getLogger() {
  if (!logger) {
    logger = createLogger({ level: getConfig().logLevel });
  }
  return logger;
}
