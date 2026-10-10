import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ALL_ROLES, ROLES } from '../../src/constants/roles.js';
import { User } from '../../src/models/User.js';
import { setUserStatus } from '../../src/services/user.service.js';
import { TEST_PASSWORD, bearer, captureLogs, createTestUser } from '../helpers/auth.js';

let app;
let admin;

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await User.init();
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
});

afterEach(async () => {
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

const setStatus = (actor, targetId, body) =>
  request(app).patch(`/api/users/${targetId}/status`).set('Authorization', bearer(actor)).send(body);

const login = (email) => request(app).post('/api/auth/login').send({ email, password: TEST_PASSWORD });

describe('PATCH /api/users/:id/status', () => {
  it.each(ALL_ROLES.filter((role) => role !== ROLES.ADMIN))('returns 403 for %s', async (role) => {
    const actor = await createTestUser({ role });
    const target = await createTestUser();
    const res = await setStatus(actor, target._id, { isActive: false });

    expect(res.status).toBe(403);
    expect((await User.findById(target._id).lean()).isActive).toBe(true);
  });

  it('deactivates a user, revokes their tokens and blocks their login', async () => {
    const worker = await createTestUser({ role: ROLES.FLOOR_MANAGER });
    const workerToken = bearer(worker);

    const res = await setStatus(admin, worker._id, { isActive: false });

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ id: String(worker._id), isActive: false });
    expect((await User.findById(worker._id).lean()).tokenVersion).toBe(1);
    expect((await request(app).get('/api/auth/me').set('Authorization', workerToken)).status).toBe(401);
    expect((await login(worker.email)).status).toBe(401);
  });

  it('reactivates a user: they can log in again, but old tokens stay revoked', async () => {
    const worker = await createTestUser();
    const oldToken = bearer(worker);
    await setStatus(admin, worker._id, { isActive: false });

    const res = await setStatus(admin, worker._id, { isActive: true });
    expect(res.status).toBe(200);
    expect(res.body.data.user.isActive).toBe(true);

    expect((await request(app).get('/api/auth/me').set('Authorization', oldToken)).status).toBe(401);
    const relogin = await login(worker.email);
    expect(relogin.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${relogin.body.data.token}`);
    expect(me.status).toBe(200);
  });

  it('is idempotent: deactivating twice does not revoke tokens twice', async () => {
    const worker = await createTestUser();
    await setStatus(admin, worker._id, { isActive: false });
    const second = await setStatus(admin, worker._id, { isActive: false });

    expect(second.status).toBe(200);
    expect((await User.findById(worker._id).lean()).tokenVersion).toBe(1);
  });

  it('returns 409 CANNOT_DEACTIVATE_SELF when an admin targets their own account', async () => {
    await createTestUser({ role: ROLES.ADMIN }); // another admin exists, so this is not the last-admin rule
    const res = await setStatus(admin, admin._id, { isActive: false });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CANNOT_DEACTIVATE_SELF');
    expect((await User.findById(admin._id).lean()).isActive).toBe(true);
  });

  it('lets an admin deactivate another admin when one would remain', async () => {
    const otherAdmin = await createTestUser({ role: ROLES.ADMIN });
    const res = await setStatus(admin, otherAdmin._id, { isActive: false });
    expect(res.status).toBe(200);
  });

  it('never leaves zero active admins when two admins deactivate each other at once', async () => {
    const otherAdmin = await createTestUser({ role: ROLES.ADMIN });

    const results = await Promise.all([
      setStatus(admin, otherAdmin._id, { isActive: false }),
      setStatus(otherAdmin, admin._id, { isActive: false }),
    ]);
    const statuses = results.map((res) => res.status).sort();

    expect(statuses.filter((status) => status === 200)).toHaveLength(1);
    // The loser is either refused by the guard (409) or, if the winner committed first,
    // already deactivated and therefore unauthenticated (401).
    expect([401, 409]).toContain(statuses.find((status) => status !== 200));
    expect(await User.countDocuments({ role: ROLES.ADMIN, isActive: true })).toBe(1);
  });

  it('returns 404 for an unknown user and 400 for a malformed id', async () => {
    expect((await setStatus(admin, '64b7f0c2a1b2c3d4e5f60718', { isActive: false })).status).toBe(404);
    expect((await setStatus(admin, 'not-an-id', { isActive: false })).status).toBe(400);
  });

  it.each([
    ['a missing isActive', {}],
    ['a string isActive', { isActive: 'false' }],
    ['an extra field', { isActive: false, role: 'ADMIN' }],
  ])('returns 400 for %s', async (_label, body) => {
    const worker = await createTestUser();
    expect((await setStatus(admin, worker._id, body)).status).toBe(400);
  });
});

describe('setUserStatus service: last-admin rule', () => {
  it('refuses to deactivate the only active admin (LAST_ACTIVE_ADMIN)', async () => {
    // Unreachable through the API sequentially (the actor is itself an active admin),
    // so the rule is exercised directly: it is the backstop for the race above.
    const systemActor = { id: '64b7f0c2a1b2c3d4e5f60718' };

    await expect(setUserStatus(String(admin._id), false, systemActor)).rejects.toMatchObject({
      code: 'LAST_ACTIVE_ADMIN',
      status: 409,
    });
    expect((await User.findById(admin._id).lean()).isActive).toBe(true);
  });

  it('serialises concurrent service calls so exactly one admin remains', async () => {
    const otherAdmin = await createTestUser({ role: ROLES.ADMIN });
    const results = await Promise.allSettled([
      setUserStatus(String(otherAdmin._id), false, { id: String(admin._id) }),
      setUserStatus(String(admin._id), false, { id: String(otherAdmin._id) }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason.code).toBe('LAST_ACTIVE_ADMIN');
    expect(await User.countDocuments({ role: ROLES.ADMIN, isActive: true })).toBe(1);
  });
});

describe('GET /api/users', () => {
  it('returns 403 for a non-admin', async () => {
    const keeper = await createTestUser({ role: ROLES.STORE_KEEPER });
    expect((await request(app).get('/api/users').set('Authorization', bearer(keeper))).status).toBe(403);
  });

  it('lists public users, newest first, with pagination meta', async () => {
    await createTestUser({ role: ROLES.BUYER });
    await createTestUser({ role: ROLES.QC_INSPECTOR });

    const res = await request(app).get('/api/users').set('Authorization', bearer(admin));

    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 1, limit: 50, total: 3 });
    expect(res.body.data.users).toHaveLength(3);
    expect(res.body.data.users[0].role).toBe('QC_INSPECTOR');
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|tokenVersion|\$2[aby]\$/);
  });

  it('filters by role and isActive', async () => {
    await createTestUser({ role: ROLES.BUYER });
    await createTestUser({ role: ROLES.BUYER, isActive: false });

    const buyers = await request(app).get('/api/users?role=BUYER').set('Authorization', bearer(admin));
    const inactiveBuyers = await request(app)
      .get('/api/users?role=BUYER&isActive=false')
      .set('Authorization', bearer(admin));

    expect(buyers.body.meta.total).toBe(2);
    expect(inactiveBuyers.body.meta.total).toBe(1);
    expect(inactiveBuyers.body.data.users[0].isActive).toBe(false);
  });

  it('paginates', async () => {
    await Promise.all([1, 2, 3, 4].map(() => createTestUser()));
    const res = await request(app).get('/api/users?page=2&limit=2').set('Authorization', bearer(admin));

    expect(res.body.meta).toEqual({ page: 2, limit: 2, total: 5 });
    expect(res.body.data.users).toHaveLength(2);
  });

  it.each(['role=SUPERUSER', 'isActive=maybe', 'limit=1000', 'page=0'])('returns 400 for ?%s', async (query) => {
    const res = await request(app).get(`/api/users?${query}`).set('Authorization', bearer(admin));
    expect(res.status).toBe(400);
  });
});
