import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { getConfig } from '../../src/config/env.js';
import { ROLES } from '../../src/constants/roles.js';
import { authenticate } from '../../src/middleware/authenticate.js';
import { authorize } from '../../src/middleware/authorize.js';
import { createErrorHandler } from '../../src/middleware/errorHandler.js';
import { requestLogger } from '../../src/middleware/requestLogger.js';
import { User } from '../../src/models/User.js';
import { JWT_AUDIENCE, JWT_ISSUER } from '../../src/services/token.service.js';
import { bearer, captureLogs, createTestUser, tokenFor } from '../helpers/auth.js';

function buildApp(logger) {
  const app = express();
  app.use(requestLogger(logger));
  app.get('/whoami', authenticate, (req, res) => res.json({ user: req.user, frozen: Object.isFrozen(req.user) }));
  app.get('/admin-only', authenticate, authorize(ROLES.ADMIN), (req, res) => res.json({ ok: true }));
  app.get('/stock', authenticate, authorize(ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER), (req, res) => res.json({ ok: true }));
  app.get('/forgot-authenticate', authorize(ROLES.ADMIN), (req, res) => res.json({ ok: true }));
  app.use(createErrorHandler({ logger }));
  return app;
}

let app;
let logs;

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
});

beforeEach(() => {
  logs = captureLogs();
  app = buildApp(logs.logger);
});

afterEach(async () => {
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('authenticate', () => {
  it('returns 401 when there is no Authorization header', async () => {
    const res = await request(app).get('/whoami');

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it.each([
    ['a Basic scheme', 'Basic dXNlcjpwYXNz'],
    ['Bearer with no token', 'Bearer'],
    ['Bearer with two tokens', 'Bearer aaa.bbb.ccc ddd.eee.fff'],
    ['a raw token without scheme', 'aaa.bbb.ccc'],
    ['a garbage token', 'Bearer not-a-jwt'],
  ])('returns 401 for %s', async (_label, header) => {
    const res = await request(app).get('/whoami').set('Authorization', header);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('accepts a valid token and attaches a frozen req.user without secrets', async () => {
    const user = await createTestUser({ role: ROLES.QC_INSPECTOR });
    const res = await request(app).get('/whoami').set('Authorization', bearer(user));

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: String(user._id), role: 'QC_INSPECTOR', name: user.name, email: user.email });
    expect(res.body.frozen).toBe(true);
  });

  it('accepts a lowercase "bearer" scheme', async () => {
    const user = await createTestUser();
    const res = await request(app).get('/whoami').set('Authorization', `bearer ${tokenFor(user)}`);
    expect(res.status).toBe(200);
  });

  it('returns 401 TOKEN_EXPIRED for a genuine expired token', async () => {
    const user = await createTestUser();
    const expired = jwt.sign(
      { tv: 0, sub: String(user._id), iss: JWT_ISSUER, aud: JWT_AUDIENCE, exp: Math.floor(Date.now() / 1000) - 5 },
      getConfig().jwtSecret,
      { algorithm: 'HS256' },
    );
    const res = await request(app).get('/whoami').set('Authorization', `Bearer ${expired}`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects a previously issued token once the user is deactivated', async () => {
    const user = await createTestUser();
    const header = bearer(user);
    expect((await request(app).get('/whoami').set('Authorization', header)).status).toBe(200);

    await User.updateOne({ _id: user._id }, { isActive: false });
    const res = await request(app).get('/whoami').set('Authorization', header);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'UNAUTHENTICATED', message: 'Invalid or missing authentication token' });
  });

  it('rejects a token issued before tokenVersion was bumped', async () => {
    const user = await createTestUser();
    const header = bearer(user);

    await User.updateOne({ _id: user._id }, { $inc: { tokenVersion: 1 } });
    expect((await request(app).get('/whoami').set('Authorization', header)).status).toBe(401);
  });

  it('rejects a token for a user that no longer exists', async () => {
    const user = await createTestUser();
    const header = bearer(user);

    await User.deleteOne({ _id: user._id });
    expect((await request(app).get('/whoami').set('Authorization', header)).status).toBe(401);
  });

  it('gives identical responses for deactivated, revoked and deleted users', async () => {
    const [a, b, c] = await Promise.all([createTestUser(), createTestUser(), createTestUser()]);
    const headers = [bearer(a), bearer(b), bearer(c)];
    await User.updateOne({ _id: a._id }, { isActive: false });
    await User.updateOne({ _id: b._id }, { $inc: { tokenVersion: 1 } });
    await User.deleteOne({ _id: c._id });

    const bodies = await Promise.all(
      headers.map(async (header) => {
        const res = await request(app).get('/whoami').set('Authorization', header);
        const { requestId, ...rest } = res.body.error;
        return { status: res.status, ...rest };
      }),
    );
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[1]).toEqual(bodies[2]);
  });
});

describe('authorize', () => {
  it('lets an ADMIN through an admin-only route', async () => {
    const admin = await createTestUser({ role: ROLES.ADMIN });
    expect((await request(app).get('/admin-only').set('Authorization', bearer(admin))).status).toBe(200);
  });

  it('returns 403 for a BUYER on an admin-only route', async () => {
    const buyer = await createTestUser({ role: ROLES.BUYER });
    const res = await request(app).get('/admin-only').set('Authorization', bearer(buyer));

    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({
      code: 'FORBIDDEN',
      message: 'You do not have permission to perform this action',
    });
  });

  it('returns 403 for a FLOOR_MANAGER on an admin-only route', async () => {
    const manager = await createTestUser({ role: ROLES.FLOOR_MANAGER });
    const res = await request(app).get('/admin-only').set('Authorization', bearer(manager));

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('does not reveal which roles are allowed', async () => {
    const buyer = await createTestUser({ role: ROLES.BUYER });
    const res = await request(app).get('/admin-only').set('Authorization', bearer(buyer));
    expect(JSON.stringify(res.body)).not.toContain('ADMIN');
  });

  it('allows any of several listed roles', async () => {
    const keeper = await createTestUser({ role: ROLES.STORE_KEEPER });
    const manager = await createTestUser({ role: ROLES.FLOOR_MANAGER });
    const qc = await createTestUser({ role: ROLES.QC_INSPECTOR });

    expect((await request(app).get('/stock').set('Authorization', bearer(keeper))).status).toBe(200);
    expect((await request(app).get('/stock').set('Authorization', bearer(manager))).status).toBe(200);
    expect((await request(app).get('/stock').set('Authorization', bearer(qc))).status).toBe(403);
  });

  it('uses the role from the database, not the token: a demotion applies immediately', async () => {
    const user = await createTestUser({ role: ROLES.ADMIN });
    const header = bearer(user);
    expect((await request(app).get('/admin-only').set('Authorization', header)).status).toBe(200);

    await User.updateOne({ _id: user._id }, { role: ROLES.BUYER });
    expect((await request(app).get('/admin-only').set('Authorization', header)).status).toBe(403);
  });

  it('fails closed with 401 when mounted without authenticate', async () => {
    const res = await request(app).get('/forgot-authenticate');
    expect(res.status).toBe(401);
  });

  it('throws at definition time for no roles or unknown roles', () => {
    expect(() => authorize()).toThrow(TypeError);
    expect(() => authorize('ADMN')).toThrow(/unknown role\(s\): ADMN/);
    expect(() => authorize(ROLES.ADMIN, 'admin')).toThrow(TypeError);
  });
});

describe('logging', () => {
  it('adds userId to the completion log line of an authenticated request', async () => {
    const user = await createTestUser();
    await request(app).get('/whoami').set('Authorization', bearer(user));

    const completed = logs.lines.find((line) => line.msg === 'request completed');
    expect(completed.userId).toBe(String(user._id));
  });

  it('adds userId to the error handler line of a forbidden request', async () => {
    const buyer = await createTestUser({ role: ROLES.BUYER });
    await request(app).get('/admin-only').set('Authorization', bearer(buyer));

    const forbidden = logs.lines.find((line) => line.code === 'FORBIDDEN');
    expect(forbidden.userId).toBe(String(buyer._id));
  });

  it('never logs the token itself', async () => {
    const user = await createTestUser();
    const token = tokenFor(user);
    await request(app).get('/whoami').set('Authorization', `Bearer ${token}`);

    expect(logs.raw.join('')).not.toContain(token);
  });
});

describe('secure-by-default routing in the real app', () => {
  it('answers 404 for an unknown /api route once authenticated', async () => {
    const realApp = createApp({ logger: captureLogs('silent').logger });
    const user = await createTestUser();

    const anonymous = await request(realApp).get('/api/yarns');
    const authenticated = await request(realApp).get('/api/yarns').set('Authorization', bearer(user));

    expect(anonymous.status).toBe(401);
    expect(authenticated.status).toBe(404);
  });
});
