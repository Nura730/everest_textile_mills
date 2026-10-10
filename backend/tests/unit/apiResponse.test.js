import express from 'express';
import request from 'supertest';
import { AppError } from '../../src/utils/AppError.js';
import { ERROR_CODES } from '../../src/utils/errorCodes.js';
import { sendError, sendSuccess } from '../../src/utils/apiResponse.js';

describe('AppError', () => {
  it('derives the HTTP status from the code', () => {
    const error = new AppError('NOT_FOUND', 'Yarn not found');

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('NOT_FOUND');
    expect(error.status).toBe(404);
    expect(error.message).toBe('Yarn not found');
    expect(error.isOperational).toBe(true);
  });

  it('carries details and cause', () => {
    const cause = new Error('low level');
    const error = new AppError('CONFLICT', 'Conflict', { details: { available: 400 }, cause });

    expect(error.details).toEqual({ available: 400 });
    expect(error.cause).toBe(cause);
  });

  it('rejects an unknown code', () => {
    expect(() => new AppError('INSUFICIENT_STOK', 'typo')).toThrow(TypeError);
  });

  it('uses 409 for state conflicts and 400 for bad requests', () => {
    expect(ERROR_CODES.CONFLICT).toBe(409);
    expect(ERROR_CODES.VALIDATION_ERROR).toBe(400);
    expect(Object.values(ERROR_CODES)).not.toContain(422);
  });
});

function appWith(handler) {
  const app = express();
  app.get('/', handler);
  return app;
}

describe('sendSuccess', () => {
  it('wraps data with status 200 by default', async () => {
    const res = await request(appWith((req, res) => sendSuccess(res, { id: 1 }))).get('/');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { id: 1 } });
  });

  it('supports 201 and meta', async () => {
    const handler = (req, res) => sendSuccess(res, [{ id: 1 }], { status: 201, meta: { total: 1 } });
    const res = await request(appWith(handler)).get('/');

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ success: true, data: [{ id: 1 }], meta: { total: 1 } });
  });

  it('returns data: null rather than omitting it', async () => {
    const res = await request(appWith((req, res) => sendSuccess(res, undefined))).get('/');
    expect(res.body).toEqual({ success: true, data: null });
  });

  it.each([204, 302, 400, 500, 200.5])('rejects status %s', (status) => {
    expect(() => sendSuccess({}, {}, { status })).toThrow(TypeError);
  });
});

describe('sendError', () => {
  it('renders the error envelope without data', async () => {
    const error = new AppError('CONFLICT', 'Only 400 kg available', { details: { available: 400, requested: 850 } });
    const res = await request(appWith((req, res) => sendError(res, error, 'req-12345678'))).get('/');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'CONFLICT',
        message: 'Only 400 kg available',
        details: { available: 400, requested: 850 },
        requestId: 'req-12345678',
      },
    });
  });

  it('omits details when there are none', async () => {
    const error = new AppError('FORBIDDEN', 'No access');
    const res = await request(appWith((req, res) => sendError(res, error, 'req-12345678'))).get('/');

    expect(res.body.error).not.toHaveProperty('details');
  });
});
