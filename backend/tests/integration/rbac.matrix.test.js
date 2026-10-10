import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ALL_ROLES, ROLES } from '../../src/constants/roles.js';
import { resetLoginRateLimits } from '../../src/middleware/rateLimit.js';
import { User } from '../../src/models/User.js';
import { TEST_PASSWORD, bearer, captureLogs, createTestUser } from '../helpers/auth.js';

/**
 * THE PERMISSION MATRIX. Every protected route and the roles allowed to call it.
 * Each later phase adds its routes here; a route missing from this table is a review flag.
 * `build` returns { path, body } for a fresh, valid request so allowed roles get past
 * validation and the test checks authorization only.
 */
let seq = 0;
const MATRIX = [
  {
    name: 'GET /api/auth/me',
    method: 'get',
    allowed: ALL_ROLES,
    build: async () => ({ path: '/api/auth/me' }),
  },
  {
    name: 'GET /api/users',
    method: 'get',
    allowed: [ROLES.ADMIN],
    build: async () => ({ path: '/api/users' }),
  },
  {
    name: 'POST /api/users',
    method: 'post',
    allowed: [ROLES.ADMIN],
    build: async () => {
      seq += 1;
      return {
        path: '/api/users',
        body: { name: 'Matrix User', email: `matrix-${seq}@everest.test`, password: TEST_PASSWORD, role: ROLES.BUYER },
      };
    },
  },
  {
    name: 'PATCH /api/users/:id/status',
    method: 'patch',
    allowed: [ROLES.ADMIN],
    build: async () => {
      const target = await createTestUser();
      return { path: `/api/users/${target._id}/status`, body: { isActive: false } };
    },
  },
];

let app;
let logs;

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await User.init();
});

beforeEach(async () => {
  logs = captureLogs();
  app = createApp({ logger: logs.logger });
});

afterEach(async () => {
  await User.deleteMany({});
});

afterAll(async () => {
  await resetLoginRateLimits();
  await disconnectDatabase();
});

async function call(route, actor) {
  const { path, body } = await route.build();
  let req = request(app)[route.method](path);
  if (actor) req = req.set('Authorization', bearer(actor));
  return body === undefined ? req : req.send(body);
}

const cases = MATRIX.flatMap((route) =>
  ALL_ROLES.map((role) => [route.name, role, route.allowed.includes(role) ? 'allowed' : 'forbidden', route]),
);

describe('RBAC matrix', () => {
  it.each(MATRIX.map((route) => [route.name, route]))('%s returns 401 without a token', async (_name, route) => {
    const res = await call(route, null);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each(cases)('%s as %s is %s', async (_name, role, verdict, route) => {
    const actor = await createTestUser({ role });
    const res = await call(route, actor);

    if (verdict === 'allowed') {
      expect(res.status).toBeLessThan(400);
    } else {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });
});

describe('credential leak sweep', () => {
  it('no response body or log line anywhere in the API contains a password or bcrypt hash', async () => {
    const admin = await createTestUser({ role: ROLES.ADMIN });
    const bodies = [];

    bodies.push((await request(app).post('/api/auth/login').send({ email: admin.email, password: TEST_PASSWORD })).body);
    bodies.push((await request(app).post('/api/auth/login').send({ email: admin.email, password: 'nope-nope-nope' })).body);
    for (const route of MATRIX) {
      for (const role of ALL_ROLES) {
        const actor = role === ROLES.ADMIN ? admin : await createTestUser({ role });
        bodies.push((await call(route, actor)).body);
      }
    }

    const hashes = (await User.find().select('+passwordHash').lean()).map((user) => user.passwordHash);
    const everything = [...bodies.map((body) => JSON.stringify(body)), ...logs.raw].join('\n');

    expect(everything).not.toContain(TEST_PASSWORD);
    expect(everything).not.toMatch(/\$2[aby]\$\d\d\$/);
    for (const hash of hashes) expect(everything).not.toContain(hash);
  });
});
