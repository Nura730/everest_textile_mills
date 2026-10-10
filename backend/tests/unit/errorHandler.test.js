import { Writable } from 'node:stream';
import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { z } from 'zod';
import { createLogger } from '../../src/config/logger.js';
import { createErrorHandler, normalizeError } from '../../src/middleware/errorHandler.js';
import { notFound } from '../../src/middleware/notFound.js';
import { requestLogger } from '../../src/middleware/requestLogger.js';
import { validate } from '../../src/middleware/validate.js';
import { AppError } from '../../src/utils/AppError.js';

function namedError(name, message, extra = {}) {
  return Object.assign(new Error(message), { name }, extra);
}

describe('normalizeError', () => {
  it('passes AppError through unchanged', () => {
    const error = new AppError('FORBIDDEN', 'No access');
    expect(normalizeError(error)).toBe(error);
  });

  it('maps ZodError to VALIDATION_ERROR with per-field details', () => {
    const { error } = z.object({ quantity: z.number().positive() }).safeParse({ quantity: -5 });
    const result = normalizeError(error);

    expect(result).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    expect(result.details).toEqual([expect.objectContaining({ path: 'quantity' })]);
  });

  it('maps a mongoose CastError (bad ObjectId) to VALIDATION_ERROR', () => {
    const castError = new mongoose.Error.CastError('ObjectId', 'abc', 'yarnId');
    expect(normalizeError(castError)).toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
      details: [{ path: 'yarnId', message: 'Expected a valid ObjectId' }],
    });
  });

  it('maps a mongoose ValidationError to VALIDATION_ERROR', async () => {
    const Model = mongoose.model('NormalizeTest', new mongoose.Schema({ quantity: { type: Number, required: true } }));
    const validationError = await new Model({}).validate().catch((err) => err);

    expect(normalizeError(validationError)).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [expect.objectContaining({ path: 'quantity' })],
    });
  });

  it('maps a duplicate key error to DUPLICATE_RESOURCE without leaking the value', () => {
    const dup = namedError('MongoServerError', 'E11000 duplicate key', {
      code: 11000,
      keyPattern: { email: 1 },
      keyValue: { email: 'owner@everest.example' },
    });
    const result = normalizeError(dup);

    expect(result).toMatchObject({ code: 'DUPLICATE_RESOURCE', status: 409, details: { fields: ['email'] } });
    expect(JSON.stringify(result.details)).not.toContain('owner@everest.example');
  });

  it.each(['MongoServerSelectionError', 'MongoNetworkError', 'MongoNetworkTimeoutError', 'MongoNotConnectedError'])(
    'maps %s to SERVICE_UNAVAILABLE',
    (name) => {
      expect(normalizeError(namedError(name, 'connection lost'))).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
      });
    },
  );

  it('maps a mongoose buffering timeout to SERVICE_UNAVAILABLE', () => {
    const err = namedError('MongooseError', 'Operation `yarns.find()` buffering timed out after 10000ms');
    expect(normalizeError(err).code).toBe('SERVICE_UNAVAILABLE');
  });

  it('maps anything else to a generic INTERNAL_ERROR', () => {
    const result = normalizeError(new TypeError("Cannot read properties of undefined (reading 'qty')"));

    expect(result).toMatchObject({ code: 'INTERNAL_ERROR', status: 500, message: 'An unexpected error occurred' });
  });
});

function captureLogs() {
  const lines = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString()));
      callback();
    },
  });
  return { lines, logger: createLogger({ level: 'info', destination }) };
}

function buildApp(logger) {
  const app = express();
  app.use(requestLogger(logger));
  app.use(express.json({ limit: '1kb' }));

  app.get('/conflict', () => {
    throw new AppError('CONFLICT', 'Only 400 kg available', { details: { available: 400, requested: 850 } });
  });
  app.get('/bug', async () => {
    await Promise.resolve();
    throw new TypeError('secret internal detail: users collection');
  });
  app.post(
    '/validated/:yarnId',
    validate({
      params: z.object({ yarnId: z.string().length(24) }),
      query: z.object({ dryRun: z.coerce.boolean().default(false) }),
      body: z.object({ quantity: z.number().positive() }),
    }),
    (req, res) => res.json({ validated: req.validated }),
  );
  app.post('/echo', (req, res) => res.json({ body: req.body }));

  app.use(notFound);
  app.use(createErrorHandler({ logger }));
  return app;
}

describe('error handling over HTTP', () => {
  it('renders an AppError thrown in a route', async () => {
    const { logger } = captureLogs();
    const res = await request(buildApp(logger)).get('/conflict');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'CONFLICT',
        message: 'Only 400 kg available',
        details: { available: 400, requested: 850 },
        requestId: res.headers['x-request-id'],
      },
    });
  });

  it('catches async errors (Express 5) and hides internals from the client', async () => {
    const { lines, logger } = captureLogs();
    const res = await request(buildApp(logger)).get('/bug');

    expect(res.status).toBe(500);
    expect(res.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId: res.headers['x-request-id'],
    });
    expect(JSON.stringify(res.body)).not.toMatch(/secret internal detail|stack/);

    const errorLog = lines.find((line) => line.code === 'INTERNAL_ERROR');
    expect(errorLog.level).toBe(50); // pino "error"
    expect(errorLog.err.stack).toContain('secret internal detail');
    expect(errorLog.req.id).toBe(res.headers['x-request-id']);
  });

  it('logs 4xx at warn without a stack', async () => {
    const { lines, logger } = captureLogs();
    await request(buildApp(logger)).get('/conflict');

    const warnLog = lines.find((line) => line.code === 'CONFLICT');
    expect(warnLog.level).toBe(40); // pino "warn"
    expect(warnLog).not.toHaveProperty('err');
  });

  it('returns 404 NOT_FOUND for an unknown route', async () => {
    const { logger } = captureLogs();
    const res = await request(buildApp(logger)).get('/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('Route not found: GET /does-not-exist');
  });

  it('returns 400 INVALID_JSON for a malformed body', async () => {
    const { logger } = captureLogs();
    const res = await request(buildApp(logger)).post('/echo').set('Content-Type', 'application/json').send('{"qty": ');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 413 PAYLOAD_TOO_LARGE for an oversized body', async () => {
    const { logger } = captureLogs();
    const res = await request(buildApp(logger)).post('/echo').send({ notes: 'x'.repeat(2048) });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('validate middleware', () => {
  const VALID_ID = '64b7f0c2a1b2c3d4e5f60718';

  it('puts parsed params, query and body on req.validated', async () => {
    const { logger } = captureLogs();
    const res = await request(buildApp(logger)).post(`/validated/${VALID_ID}?dryRun=1`).send({ quantity: 850, extra: 'x' });

    expect(res.status).toBe(200);
    expect(res.body.validated).toEqual({
      params: { yarnId: VALID_ID },
      query: { dryRun: true },
      body: { quantity: 850 }, // unknown keys stripped
    });
  });

  it('reports every invalid field with its location', async () => {
    const { logger } = captureLogs();
    const res = await request(buildApp(logger)).post('/validated/short').send({ quantity: -1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual([
      expect.objectContaining({ location: 'params', path: 'yarnId' }),
      expect.objectContaining({ location: 'body', path: 'quantity' }),
    ]);
  });

  it('treats a missing body as an empty object', async () => {
    const { logger } = captureLogs();
    const res = await request(buildApp(logger)).post(`/validated/${VALID_ID}`);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([expect.objectContaining({ location: 'body', path: 'quantity' })]);
  });
});
