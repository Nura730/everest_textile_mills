import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { createLogger } from '../../src/config/logger.js';
import { parseEnv } from '../../src/config/env.js';

const config = parseEnv({
  NODE_ENV: 'test',
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_SECRET: process.env.JWT_SECRET,
  CORS_ORIGINS: 'http://localhost:5173',
});
const app = createApp({ config, logger: createLogger({ level: 'silent' }) });

describe('GET /api/health', () => {
  afterAll(async () => {
    await disconnectDatabase();
  });

  it('returns 503 SERVICE_UNAVAILABLE before the database is connected', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({
      success: false,
      error: { code: 'SERVICE_UNAVAILABLE', details: { db: 'disconnected' } },
    });
  });

  it('returns 200 with the success envelope when connected', async () => {
    await connectDatabase(process.env.MONGODB_URI);
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { status: 'ok', db: 'connected', uptimeSeconds: expect.any(Number) },
    });
  });
});

describe('app wiring', () => {
  it('returns the 404 envelope for unknown routes with a request id', async () => {
    const res = await request(app).get('/api/yarns');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found: GET /api/yarns',
        requestId: res.headers['x-request-id'],
      },
    });
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/api/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers).not.toHaveProperty('x-powered-by');
  });

  it('allows the configured frontend origin and exposes X-Request-Id', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-expose-headers']).toContain('X-Request-Id');
  });

  it('does not grant CORS to unknown origins', async () => {
    const res = await request(app).get('/api/health').set('Origin', 'https://evil.example');

    expect(res.headers).not.toHaveProperty('access-control-allow-origin');
  });

  it('answers CORS preflight for the frontend', async () => {
    const res = await request(app)
      .options('/api/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('rejects a body over the configured limit with 413', async () => {
    const res = await request(app).post('/api/health').send({ notes: 'x'.repeat(200 * 1024) });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('uses the simple query parser so ?a[$ne]=x cannot become a Mongo operator', () => {
    expect(app.get('query parser')).toBe('simple');
  });
});
