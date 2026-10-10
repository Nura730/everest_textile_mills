import express from 'express';
import request from 'supertest';
import { createLogger } from '../../src/config/logger.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { requireIdempotencyKey } from '../../src/middleware/idempotencyKey.js';
import { sendIdempotent } from '../../src/utils/apiResponse.js';

const app = express();
app.post('/op', requireIdempotencyKey, (req, res) => res.json({ key: req.idempotencyKey }));
app.get('/replayed', (req, res) => sendIdempotent(res, { statusCode: 201, body: { ok: true }, replayed: true }));
app.get('/fresh', (req, res) => sendIdempotent(res, { statusCode: 201, body: { ok: true }, replayed: false }));
app.use(createErrorHandler({ logger: createLogger({ level: 'silent' }) }));

describe('requireIdempotencyKey', () => {
  it('accepts a UUID and exposes it as req.idempotencyKey', async () => {
    const key = '3f2c9a1e-5b7d-4c1a-9e8f-0123456789ab';
    const res = await request(app).post('/op').set('Idempotency-Key', key);
    expect(res.body.key).toBe(key);
  });

  it.each([
    ['missing', undefined],
    ['too short', 'abc'],
    ['too long', 'a'.repeat(65)],
    ['with spaces', 'not a valid key'],
  ])('rejects a %s key with 400 naming the header', async (_label, key) => {
    let req = request(app).post('/op');
    if (key !== undefined) req = req.set('Idempotency-Key', key);
    const res = await req;

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0]).toMatchObject({ location: 'headers', path: 'Idempotency-Key' });
  });
});

describe('sendIdempotent', () => {
  it('marks a replay with Idempotent-Replayed: true', async () => {
    const res = await request(app).get('/replayed');
    expect(res.status).toBe(201);
    expect(res.headers['idempotent-replayed']).toBe('true');
    expect(res.body).toEqual({ success: true, data: { ok: true } });
  });

  it('does not mark a fresh result', async () => {
    const res = await request(app).get('/fresh');
    expect(res.headers).not.toHaveProperty('idempotent-replayed');
  });
});
