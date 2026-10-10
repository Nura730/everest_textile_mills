import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import {
  LOGIN_ACCOUNT_LIMIT,
  LOGIN_IP_LIMIT,
  LOGIN_WINDOW_MS,
  resetLoginRateLimits,
} from '../../src/middleware/rateLimit.js';
import { User } from '../../src/models/User.js';
import { TEST_PASSWORD, captureLogs, createTestUser } from '../helpers/auth.js';

let app;

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
});

beforeEach(async () => {
  await resetLoginRateLimits();
  app = createApp({ logger: captureLogs('silent').logger });
});

afterEach(async () => {
  await User.deleteMany({});
});

afterAll(async () => {
  await resetLoginRateLimits();
  await disconnectDatabase();
});

const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });

async function failTimes(email, times) {
  for (let i = 0; i < times; i += 1) {
    expect((await login(email, 'Wrong-Password-1')).status).toBe(401);
  }
}

describe('per-account login limit', () => {
  it(`blocks the ${LOGIN_ACCOUNT_LIMIT + 1}th failed attempt with 429 and Retry-After`, async () => {
    const user = await createTestUser();
    await failTimes(user.email, LOGIN_ACCOUNT_LIMIT);

    const res = await login(user.email, 'Wrong-Password-1');

    expect(res.status).toBe(429);
    expect(res.body.error).toMatchObject({
      code: 'TOO_MANY_REQUESTS',
      details: { retryAfterSeconds: expect.any(Number) },
    });
    const retryAfter = Number(res.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(LOGIN_WINDOW_MS / 1000);
    expect(res.body.error.details.retryAfterSeconds).toBe(retryAfter);
  });

  it('keeps blocking that account even with the correct password', async () => {
    const user = await createTestUser();
    await failTimes(user.email, LOGIN_ACCOUNT_LIMIT);

    expect((await login(user.email, TEST_PASSWORD)).status).toBe(429);
  });

  it('counts the same account regardless of email case and spaces', async () => {
    const user = await createTestUser();
    await failTimes(user.email.toUpperCase(), LOGIN_ACCOUNT_LIMIT);

    expect((await login(`  ${user.email} `, 'Wrong-Password-1')).status).toBe(429);
  });

  it('does not block a different account from the same IP (shared factory IP)', async () => {
    const victim = await createTestUser();
    const colleague = await createTestUser();
    await failTimes(victim.email, LOGIN_ACCOUNT_LIMIT);
    expect((await login(victim.email, 'Wrong-Password-1')).status).toBe(429);

    expect((await login(colleague.email, TEST_PASSWORD)).status).toBe(200);
  });

  it('does not count successful logins', async () => {
    const user = await createTestUser();
    for (let i = 0; i < LOGIN_ACCOUNT_LIMIT + 3; i += 1) {
      expect((await login(user.email, TEST_PASSWORD)).status).toBe(200);
    }
  });

  it('does not count malformed requests against the account', async () => {
    const user = await createTestUser();
    for (let i = 0; i < LOGIN_ACCOUNT_LIMIT + 1; i += 1) {
      expect((await request(app).post('/api/auth/login').send({ email: user.email })).status).toBe(400);
    }
    expect((await login(user.email, TEST_PASSWORD)).status).toBe(200);
  });

  it('sends standard RateLimit headers without exposing the email', async () => {
    const user = await createTestUser();
    const res = await login(user.email, 'Wrong-Password-1');

    expect(res.headers).toHaveProperty('ratelimit');
    expect(res.headers).toHaveProperty('ratelimit-policy');
    expect(JSON.stringify(res.headers)).not.toContain(user.email);
  });
});

describe('per-IP login backstop', () => {
  it(`blocks the ${LOGIN_IP_LIMIT + 1}th attempt from one IP across many emails`, async () => {
    for (let i = 0; i < LOGIN_IP_LIMIT; i += 1) {
      const res = await login(`spray-${i}@everest.test`, 'Wrong-Password-1');
      expect(res.status).toBe(401);
    }

    const res = await login('spray-last@everest.test', 'Wrong-Password-1');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
  });
});
