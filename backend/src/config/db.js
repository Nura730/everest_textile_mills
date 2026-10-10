import mongoose from 'mongoose';

// Fail fast: a floor tablet should get a 503 in seconds, not hang for 30s (driver default).
export const SERVER_SELECTION_TIMEOUT_MS = 5000;

const READY_STATES = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };

let listenersAttached = false;

function attachConnectionListeners(logger) {
  if (listenersAttached || !logger) return;
  listenersAttached = true;
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB connection error'));
}

export async function connectDatabase(uri, { logger, serverSelectionTimeoutMS = SERVER_SELECTION_TIMEOUT_MS } = {}) {
  // Queries issued while disconnected wait at most this long before failing (default 10s).
  mongoose.set('bufferTimeoutMS', serverSelectionTimeoutMS);
  attachConnectionListeners(logger);
  await mongoose.connect(uri, { serverSelectionTimeoutMS });
  return mongoose.connection;
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}

export function getDbStatus() {
  return READY_STATES[mongoose.connection.readyState] ?? 'unknown';
}
