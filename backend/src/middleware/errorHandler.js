import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';
import { sendError } from '../utils/apiResponse.js';

const DB_UNAVAILABLE_ERRORS = new Set([
  'MongoServerSelectionError',
  'MongoNetworkError',
  'MongoNetworkTimeoutError',
  'MongoNotConnectedError',
]);

function isDatabaseUnavailable(err) {
  if (DB_UNAVAILABLE_ERRORS.has(err.name)) return true;
  // Mongoose raises a plain MongooseError when an operation cannot reach a connection.
  return err.name === 'MongooseError' && /buffering timed out|before initial connection/i.test(err.message);
}

function zodIssuesToDetails(issues) {
  return issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

/**
 * Turns anything thrown anywhere into an AppError. Pure: no logging, no response.
 * Unknown errors become a generic INTERNAL_ERROR so internals never reach the client.
 */
export function normalizeError(err) {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return new AppError('VALIDATION_ERROR', 'Request validation failed', {
      details: zodIssuesToDetails(err.issues),
      cause: err,
    });
  }

  // Errors raised by express.json() (body-parser) carry a `type`.
  if (err.type === 'entity.parse.failed') {
    return new AppError('INVALID_JSON', 'Request body is not valid JSON', { cause: err });
  }
  if (err.type === 'entity.too.large') {
    return new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large', { cause: err });
  }
  if (err.type && err.expose && err.status >= 400 && err.status < 500) {
    return new AppError('VALIDATION_ERROR', 'Malformed request body', { cause: err });
  }

  if (err instanceof mongoose.Error.CastError) {
    return new AppError('VALIDATION_ERROR', `Invalid value for ${err.path}`, {
      details: [{ path: err.path, message: `Expected a valid ${err.kind}` }],
      cause: err,
    });
  }
  if (err instanceof mongoose.Error.ValidationError) {
    return new AppError('VALIDATION_ERROR', 'Request validation failed', {
      details: Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
      cause: err,
    });
  }
  if (err.code === 11000) {
    // Field names only: the duplicated value may be sensitive (e.g. an email).
    const fields = Object.keys(err.keyPattern ?? err.keyValue ?? {});
    return new AppError('DUPLICATE_RESOURCE', 'A record with the same unique value already exists', {
      details: { fields },
      cause: err,
    });
  }
  if (isDatabaseUnavailable(err)) {
    return new AppError('SERVICE_UNAVAILABLE', 'Service temporarily unavailable, please retry', { cause: err });
  }

  return new AppError('INTERNAL_ERROR', 'An unexpected error occurred', { cause: err });
}

export function createErrorHandler({ logger }) {
  // Express recognises error middleware by its four parameters; keep `next`.
  return function errorHandler(err, req, res, next) {
    if (res.headersSent) {
      // Too late to send an envelope; let Express close the connection.
      return next(err);
    }

    const appError = normalizeError(err);
    const log = req.log ?? logger;
    const context = { code: appError.code, method: req.method, path: req.originalUrl };

    if (appError.status >= 500) {
      // Full original error (with stack) for developers; the client gets only the safe message.
      log.error({ ...context, err }, appError.message);
    } else {
      log.warn({ ...context, details: appError.details }, appError.message);
    }

    return sendError(res, appError, req.id);
  };
}
