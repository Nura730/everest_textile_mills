import bcrypt from 'bcryptjs';
import { jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { User } from '../../src/models/User.js';
import { verifyAccessToken } from '../../src/services/token.service.js';
import { TEST_PASSWORD, bearer, captureLogs, createTestUser } from '../helpers/auth.js';

let app;
let logs;

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await User.init();
});

beforeEach(() => {
  logs = captureLogs();
  app = createApp({ logger: logs.logger });
});

afterEach(async () => {
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

const login = (body) => request(app).post('/api/auth/login').send(body);
const withoutRequestId = ({ requestId, ...rest }) => rest;

describe('POST /api/auth/login', () => {
  it('returns a token, its expiry and the public user', async () => {
    const user = await createTestUser({ role: ROLES.STORE_KEEPER });
    const res = await login({ email: user.email, password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      success: true,
      data: {
        token: expect.any(String),
        tokenType: 'Bearer',
        expiresAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        user: {
          id: String(user._id),
          name: user.name,
          email: user.email,
          role: 'STORE_KEEPER',
          isActive: true,
          buyerId: null,
          lastLoginAt: expect.any(String),
          createdAt: expect.any(String),
        },
      },
    });
    expect(verifyAccessToken(res.body.data.token)).toEqual({ userId: String(user._id), tokenVersion: 0 });
  });

  it('records lastLoginAt in the database', async () => {
    const user = await createTestUser();
    await login({ email: user.email, password: TEST_PASSWORD });

    const stored = await User.findById(user._id).lean();
    expect(stored.lastLoginAt).toBeInstanceOf(Date);
  });

  it('treats the email case-insensitively and ignores surrounding spaces', async () => {
    const user = await createTestUser();
    const res = await login({ email: `  ${user.email.toUpperCase()} `, password: TEST_PASSWORD });
    expect(res.status).toBe(200);
  });

  it('issues a token that works on /me', async () => {
    const user = await createTestUser();
    const { token } = (await login({ email: user.email, password: TEST_PASSWORD })).body.data;

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(user.email);
  });

  describe('failure responses reveal nothing', () => {
    it('returns 401 INVALID_CREDENTIALS for a wrong password', async () => {
      const user = await createTestUser();
      const res = await login({ email: user.email, password: 'Wrong-Password-1' });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' });
    });

    it('returns an identical response for unknown email, wrong password and deactivated account', async () => {
      const active = await createTestUser();
      const deactivated = await createTestUser({ isActive: false });

      const wrongPassword = await login({ email: active.email, password: 'Wrong-Password-1' });
      const unknownEmail = await login({ email: 'nobody@everest.test', password: TEST_PASSWORD });
      const inactive = await login({ email: deactivated.email, password: TEST_PASSWORD });

      for (const res of [wrongPassword, unknownEmail, inactive]) {
        expect(res.status).toBe(401);
        expect(Object.keys(res.headers).sort()).toEqual(Object.keys(wrongPassword.headers).sort());
      }
      expect(withoutRequestId(unknownEmail.body.error)).toEqual(withoutRequestId(wrongPassword.body.error));
      expect(withoutRequestId(inactive.body.error)).toEqual(withoutRequestId(wrongPassword.body.error));
    });

    it('does exactly one bcrypt comparison on every failure path (equal work, equal time)', async () => {
      const active = await createTestUser();
      const deactivated = await createTestUser({ isActive: false });
      await login({ email: 'warm-up@everest.test', password: 'x' }); // creates the dummy hash once
      const compare = jest.spyOn(bcrypt, 'compare');

      const cases = [
        { email: 'nobody@everest.test', password: TEST_PASSWORD },
        { email: active.email, password: 'Wrong-Password-1' },
        { email: deactivated.email, password: TEST_PASSWORD },
      ];
      for (const body of cases) {
        compare.mockClear();
        expect((await login(body)).status).toBe(401);
        expect(compare).toHaveBeenCalledTimes(1);
      }
    });

    it('does not update lastLoginAt on a failed login', async () => {
      const user = await createTestUser();
      await login({ email: user.email, password: 'Wrong-Password-1' });

      expect((await User.findById(user._id).lean()).lastLoginAt).toBeNull();
    });
  });

  describe('validation', () => {
    it.each([
      ['a missing email', { password: TEST_PASSWORD }, 'email'],
      ['a malformed email', { email: 'not-an-email', password: TEST_PASSWORD }, 'email'],
      ['a missing password', { email: 'a@everest.test' }, 'password'],
      ['an empty password', { email: 'a@everest.test', password: '' }, 'password'],
      ['a password over 72 bytes', { email: 'a@everest.test', password: '₹'.repeat(25) }, 'password'],
      ['a non-string password', { email: 'a@everest.test', password: { $ne: null } }, 'password'],
    ])('returns 400 VALIDATION_ERROR for %s', async (_label, body, field) => {
      const res = await login(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: field })]));
    });

    it('rejects a NoSQL operator in the email instead of matching any user', async () => {
      await createTestUser();
      const res = await login({ email: { $ne: null }, password: TEST_PASSWORD });

      expect(res.status).toBe(400);
    });
  });
});

describe('GET /api/auth/me', () => {
  it('returns the current user from the database', async () => {
    const user = await createTestUser({ role: ROLES.QC_INSPECTOR });
    const res = await request(app).get('/api/auth/me').set('Authorization', bearer(user));

    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ id: String(user._id), role: 'QC_INSPECTOR', isActive: true });
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
    expect(res.body.data.user).not.toHaveProperty('tokenVersion');
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('reflects a role change made after the token was issued', async () => {
    const user = await createTestUser({ role: ROLES.BUYER });
    const header = bearer(user);
    await User.updateOne({ _id: user._id }, { role: ROLES.FLOOR_MANAGER });

    const res = await request(app).get('/api/auth/me').set('Authorization', header);
    expect(res.body.data.user.role).toBe('FLOOR_MANAGER');
  });
});

describe('credential leakage', () => {
  it('never puts the password or its hash in a response body or a log line', async () => {
    const user = await createTestUser();
    const stored = await User.findById(user._id).select('+passwordHash').lean();

    const responses = [
      await login({ email: user.email, password: TEST_PASSWORD }),
      await login({ email: user.email, password: 'Wrong-Password-1' }),
      await login({ email: 'nobody@everest.test', password: TEST_PASSWORD }),
      await login({ email: user.email }),
      await request(app).get('/api/auth/me').set('Authorization', bearer(user)),
    ];

    const everything = [...responses.map((res) => JSON.stringify(res.body)), ...logs.raw].join('\n');
    expect(everything).not.toContain(TEST_PASSWORD);
    expect(everything).not.toContain('Wrong-Password-1');
    expect(everything).not.toContain(stored.passwordHash);
    expect(everything).not.toMatch(/\$2[aby]\$\d\d\$/);
  });
});
