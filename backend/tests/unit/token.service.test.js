import jwt from 'jsonwebtoken';
import {
  JWT_AUDIENCE,
  JWT_ISSUER,
  signAccessToken,
  verifyAccessToken,
} from '../../src/services/token.service.js';

const USER = { _id: '64b7f0c2a1b2c3d4e5f60718', tokenVersion: 3 };
const SECRET = process.env.JWT_SECRET;
const base64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function expectAppError(fn, code) {
  try {
    fn();
  } catch (error) {
    expect(error).toMatchObject({ name: 'AppError', code, status: 401 });
    return;
  }
  throw new Error(`expected ${code}`);
}

describe('signAccessToken', () => {
  it('returns a token and an ISO expiry about 8 hours ahead', () => {
    const { token, expiresAt } = signAccessToken(USER);
    const hoursAhead = (Date.parse(expiresAt) - Date.now()) / 3_600_000;

    expect(typeof token).toBe('string');
    expect(hoursAhead).toBeGreaterThan(7.9);
    expect(hoursAhead).toBeLessThanOrEqual(8);
  });

  it('carries only sub, tv and standard claims (no role, email or name)', () => {
    const { token } = signAccessToken(USER);
    const decoded = jwt.decode(token, { complete: true });

    expect(decoded.header.alg).toBe('HS256');
    expect(Object.keys(decoded.payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sub', 'tv']);
    expect(decoded.payload).toMatchObject({ sub: USER._id, tv: 3, iss: JWT_ISSUER, aud: JWT_AUDIENCE });
  });
});

describe('verifyAccessToken', () => {
  it('round-trips a valid token', () => {
    const { token } = signAccessToken(USER);
    expect(verifyAccessToken(token)).toEqual({ userId: USER._id, tokenVersion: 3 });
  });

  it('rejects a tampered payload', () => {
    const [header, , signature] = signAccessToken(USER).token.split('.');
    const forgedPayload = base64url({ sub: USER._id, tv: 99, iss: JWT_ISSUER, aud: JWT_AUDIENCE, exp: nowSeconds() + 60 });

    expectAppError(() => verifyAccessToken(`${header}.${forgedPayload}.${signature}`), 'UNAUTHENTICATED');
  });

  it('rejects a token signed with another secret', () => {
    const token = jwt.sign({ tv: 0 }, 'some-other-secret-that-is-long-enough!!', {
      algorithm: 'HS256', subject: USER._id, issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: '1h',
    });
    expectAppError(() => verifyAccessToken(token), 'UNAUTHENTICATED');
  });

  it('rejects alg "none"', () => {
    const header = base64url({ alg: 'none', typ: 'JWT' });
    const payload = base64url({ sub: USER._id, tv: 0, iss: JWT_ISSUER, aud: JWT_AUDIENCE, exp: nowSeconds() + 60 });

    expectAppError(() => verifyAccessToken(`${header}.${payload}.`), 'UNAUTHENTICATED');
  });

  it('rejects a different algorithm even with the right secret (HS512)', () => {
    const token = jwt.sign({ tv: 0 }, SECRET, {
      algorithm: 'HS512', subject: USER._id, issuer: JWT_ISSUER, audience: JWT_AUDIENCE, expiresIn: '1h',
    });
    expectAppError(() => verifyAccessToken(token), 'UNAUTHENTICATED');
  });

  it('reports TOKEN_EXPIRED for a genuine expired token', () => {
    const token = jwt.sign(
      { tv: 0, sub: USER._id, iss: JWT_ISSUER, aud: JWT_AUDIENCE, exp: nowSeconds() - 10 },
      SECRET,
      { algorithm: 'HS256' },
    );
    expectAppError(() => verifyAccessToken(token), 'TOKEN_EXPIRED');
  });

  it('reports UNAUTHENTICATED, not TOKEN_EXPIRED, for an expired token with a bad signature', () => {
    const token = jwt.sign(
      { tv: 0, sub: USER._id, iss: JWT_ISSUER, aud: JWT_AUDIENCE, exp: nowSeconds() - 10 },
      'some-other-secret-that-is-long-enough!!',
      { algorithm: 'HS256' },
    );
    expectAppError(() => verifyAccessToken(token), 'UNAUTHENTICATED');
  });

  it.each([
    ['wrong issuer', { issuer: 'someone-else', audience: JWT_AUDIENCE }],
    ['wrong audience', { issuer: JWT_ISSUER, audience: 'other-api' }],
  ])('rejects a %s', (_label, claims) => {
    const token = jwt.sign({ tv: 0 }, SECRET, { algorithm: 'HS256', subject: USER._id, expiresIn: '1h', ...claims });
    expectAppError(() => verifyAccessToken(token), 'UNAUTHENTICATED');
  });

  it.each([
    ['a non-ObjectId sub', { sub: 'admin', tv: 0 }],
    ['a missing tv', { sub: USER._id }],
    ['a non-integer tv', { sub: USER._id, tv: '0' }],
  ])('rejects a validly signed token with %s', (_label, payload) => {
    const token = jwt.sign({ ...payload, iss: JWT_ISSUER, aud: JWT_AUDIENCE }, SECRET, {
      algorithm: 'HS256', expiresIn: '1h',
    });
    expectAppError(() => verifyAccessToken(token), 'UNAUTHENTICATED');
  });

  it.each(['', 'not-a-jwt', 'a.b.c'])('rejects garbage %p', (token) => {
    expectAppError(() => verifyAccessToken(token), 'UNAUTHENTICATED');
  });
});
