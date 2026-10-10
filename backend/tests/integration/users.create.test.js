import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ALL_ROLES, ROLES } from '../../src/constants/roles.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { User } from '../../src/models/User.js';
import { verifyPassword } from '../../src/services/password.service.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';

const NEW_PASSWORD = 'Weaving-Floor-2026';

function newUserBody(overrides = {}) {
  return { name: 'Meena Iyer', email: 'meena@everest.test', password: NEW_PASSWORD, role: ROLES.QC_INSPECTOR, ...overrides };
}

let app;
let logs;
let admin;

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await User.init();
});

beforeEach(async () => {
  logs = captureLogs();
  app = createApp({ logger: logs.logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
});

afterEach(async () => {
  await User.deleteMany({});
  // Account changes are audited (Phase 13); the trail is cleared around the append-only model.
  await AuditLog.collection.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

const createUser = (actor, body) => {
  const req = request(app).post('/api/users').send(body);
  return actor ? req.set('Authorization', bearer(actor)) : req;
};

describe('POST /api/users — RBAC', () => {
  it('returns 401 without a token', async () => {
    const res = await createUser(null, newUserBody());
    expect(res.status).toBe(401);
  });

  it.each(ALL_ROLES.map((role) => [role, role === ROLES.ADMIN ? 201 : 403]))(
    '%s gets %i',
    async (role, expectedStatus) => {
      const actor = role === ROLES.ADMIN ? admin : await createTestUser({ role });
      const res = await createUser(actor, newUserBody());

      expect(res.status).toBe(expectedStatus);
      if (expectedStatus === 403) {
        expect(res.body.error.code).toBe('FORBIDDEN');
        expect(await User.countDocuments({ email: 'meena@everest.test' })).toBe(0);
      }
    },
  );

  it('answers 403, not 400, to a non-admin sending an invalid body', async () => {
    const buyer = await createTestUser({ role: ROLES.BUYER });
    const res = await createUser(buyer, { role: 'SUPERUSER' });

    expect(res.status).toBe(403);
    expect(res.body.error).not.toHaveProperty('details');
  });
});

describe('POST /api/users — behaviour', () => {
  it('creates the user, returns 201 with the public shape and records createdBy', async () => {
    const res = await createUser(admin, newUserBody());

    expect(res.status).toBe(201);
    expect(res.body.data.user).toEqual({
      id: expect.any(String),
      name: 'Meena Iyer',
      email: 'meena@everest.test',
      role: 'QC_INSPECTOR',
      isActive: true,
      buyerId: null,
      lastLoginAt: null,
      createdAt: expect.any(String),
    });

    const stored = await User.findById(res.body.data.user.id).select('+passwordHash').lean();
    expect(String(stored.createdBy)).toBe(String(admin._id));
    expect(stored.passwordHash).not.toBe(NEW_PASSWORD);
    await expect(verifyPassword(NEW_PASSWORD, stored.passwordHash)).resolves.toBe(true);
  });

  it('lets the new user log in', async () => {
    await createUser(admin, newUserBody({ email: 'Meena@Everest.TEST' }));
    const res = await request(app).post('/api/auth/login').send({ email: 'meena@everest.test', password: NEW_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('QC_INSPECTOR');
  });

  it('lets an ADMIN create another ADMIN', async () => {
    const res = await createUser(admin, newUserBody({ role: ROLES.ADMIN }));
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('ADMIN');
  });

  it('returns 409 DUPLICATE_RESOURCE for an existing email, case-insensitively', async () => {
    await createUser(admin, newUserBody());
    const res = await createUser(admin, newUserBody({ email: 'MEENA@everest.test', name: 'Someone Else' }));

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'DUPLICATE_RESOURCE', details: { fields: ['email'] } });
    expect(await User.countDocuments({ email: 'meena@everest.test' })).toBe(1);
  });

  it('creates exactly one user when the same request is sent twice concurrently', async () => {
    const results = await Promise.all([createUser(admin, newUserBody()), createUser(admin, newUserBody())]);

    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await User.countDocuments({ email: 'meena@everest.test' })).toBe(1);
  });
});

describe('POST /api/users — validation', () => {
  it.each([
    ['an unknown role', { role: 'SUPERUSER' }, 'role'],
    ['a lowercase role', { role: 'admin' }, 'role'],
    ['a malformed email', { email: 'meena' }, 'email'],
    ['a 9-character password', { password: '123456789' }, 'password'],
    ['a password over 72 bytes', { password: '₹'.repeat(25) }, 'password'],
    ['a one-letter name', { name: 'M' }, 'name'],
  ])('returns 400 for %s', async (_label, overrides, field) => {
    const res = await createUser(admin, newUserBody(overrides));

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: field })]));
  });

  it('accepts a 10-character password', async () => {
    expect((await createUser(admin, newUserBody({ password: '1234567890' }))).status).toBe(201);
  });

  it.each([
    ['isActive', false],
    ['tokenVersion', 99],
    ['passwordHash', '$2b$04$attackercontrolledhashattackercontrolledhashattacke'],
    ['createdBy', '64b7f0c2a1b2c3d4e5f60718'],
  ])('rejects the unknown field %s (no mass assignment)', async (field, value) => {
    const res = await createUser(admin, { ...newUserBody(), [field]: value });

    expect(res.status).toBe(400);
    expect(await User.countDocuments({ email: 'meena@everest.test' })).toBe(0);
  });
});

describe('POST /api/users — leakage', () => {
  it('never returns or logs the new password or its hash', async () => {
    const created = await createUser(admin, newUserBody());
    const duplicate = await createUser(admin, newUserBody());
    const stored = await User.findOne({ email: 'meena@everest.test' }).select('+passwordHash').lean();

    const everything = [JSON.stringify(created.body), JSON.stringify(duplicate.body), ...logs.raw].join('\n');
    expect(everything).not.toContain(NEW_PASSWORD);
    expect(everything).not.toContain(stored.passwordHash);
    expect(everything).not.toMatch(/\$2[aby]\$\d\d\$/);
  });
});
