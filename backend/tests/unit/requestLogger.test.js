import { Writable } from 'node:stream';
import express from 'express';
import request from 'supertest';
import { createLogger } from '../../src/config/logger.js';
import { requestLogger, resolveRequestId } from '../../src/middleware/requestLogger.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
  app.get('/echo-id', (req, res) => res.json({ id: req.id }));
  return app;
}

describe('resolveRequestId', () => {
  it('keeps a well-formed incoming id', () => {
    expect(resolveRequestId('tablet-07-req-0001')).toBe('tablet-07-req-0001');
  });

  it.each([
    ['missing', undefined],
    ['too short', 'abc'],
    ['too long', 'a'.repeat(65)],
    ['contains spaces', 'fake id injected'],
    ['contains markup', '<script>alert(1)</script>'],
    ['repeated header (array)', ['aaaaaaaa', 'bbbbbbbb']],
  ])('replaces an id that is %s', (_label, incoming) => {
    expect(resolveRequestId(incoming)).toMatch(UUID_PATTERN);
  });
});

describe('requestLogger middleware', () => {
  it('generates an id, exposes it as req.id and in the X-Request-Id header', async () => {
    const { logger } = captureLogs();
    const res = await request(buildApp(logger)).get('/echo-id');

    expect(res.headers['x-request-id']).toMatch(UUID_PATTERN);
    expect(res.body.id).toBe(res.headers['x-request-id']);
  });

  it('echoes a valid client id', async () => {
    const { logger } = captureLogs();
    const res = await request(buildApp(logger)).get('/echo-id').set('X-Request-Id', 'tablet-07-req-0001');

    expect(res.headers['x-request-id']).toBe('tablet-07-req-0001');
  });

  it('replaces a malicious client id', async () => {
    const { logger } = captureLogs();
    const res = await request(buildApp(logger)).get('/echo-id').set('X-Request-Id', 'x" level=fatal msg="spoofed');

    expect(res.headers['x-request-id']).toMatch(UUID_PATTERN);
  });

  it('logs the request id and redacts credentials', async () => {
    const { lines, logger } = captureLogs();
    const res = await request(buildApp(logger))
      .get('/echo-id')
      .set('Authorization', 'Bearer super-secret-token')
      .set('Cookie', 'session=abc');

    const entry = lines.find((line) => line.req);
    expect(entry.req.id).toBe(res.headers['x-request-id']);
    expect(entry.req.headers.authorization).toBe('[REDACTED]');
    expect(entry.req.headers.cookie).toBe('[REDACTED]');
    expect(JSON.stringify(lines)).not.toContain('super-secret-token');
  });
});
