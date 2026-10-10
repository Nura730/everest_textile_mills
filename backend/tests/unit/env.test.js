import { parseEnv, EnvValidationError } from '../../src/config/env.js';

const VALID_URI = 'mongodb+srv://user:s3cret@cluster.example.net/everest';
const VALID_SECRET = 'x'.repeat(32);
// The minimum a valid environment needs; every other variable has a default.
const BASE = { MONGODB_URI: VALID_URI, JWT_SECRET: VALID_SECRET };

describe('parseEnv', () => {
  it('applies defaults when only the required variables are given', () => {
    const config = parseEnv(BASE);

    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 4000,
      mongodbUri: VALID_URI,
      logLevel: 'info',
      corsOrigins: ['http://localhost:5173'],
      jsonBodyLimit: '100kb',
      jwtSecret: VALID_SECRET,
      jwtExpiresIn: '8h',
      bcryptRounds: 12,
    });
  });

  it('coerces PORT and splits CORS_ORIGINS', () => {
    const config = parseEnv({
      ...BASE,
      MONGODB_URI: 'mongodb://localhost:27017/everest',
      PORT: '5050',
      CORS_ORIGINS: 'http://localhost:5173, https://everest.example.com',
    });

    expect(config.port).toBe(5050);
    expect(config.corsOrigins).toEqual(['http://localhost:5173', 'https://everest.example.com']);
  });

  it('defaults LOG_LEVEL to silent in test', () => {
    expect(parseEnv({ ...BASE, NODE_ENV: 'test' }).logLevel).toBe('silent');
  });

  it('returns a frozen object', () => {
    const config = parseEnv(BASE);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.corsOrigins)).toBe(true);
  });

  it('fails when MONGODB_URI is missing', () => {
    expect(() => parseEnv({ JWT_SECRET: VALID_SECRET })).toThrow(EnvValidationError);
    expect(() => parseEnv({ JWT_SECRET: VALID_SECRET })).toThrow(/MONGODB_URI: is required/);
  });

  it('fails when MONGODB_URI is not a mongodb URI', () => {
    expect(() => parseEnv({ ...BASE, MONGODB_URI: 'postgres://x' })).toThrow(/MONGODB_URI: must start with/);
  });

  it.each(['0', '70000', 'abc', '40.5'])('fails for invalid PORT %s', (port) => {
    expect(() => parseEnv({ ...BASE, PORT: port })).toThrow(/PORT/);
  });

  it('fails for an unknown NODE_ENV', () => {
    expect(() => parseEnv({ ...BASE, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('fails for a non-URL CORS origin', () => {
    expect(() => parseEnv({ ...BASE, CORS_ORIGINS: 'not a url' })).toThrow(/CORS_ORIGINS/);
  });

  it('reports every invalid field at once', () => {
    expect(() => parseEnv({ PORT: 'abc', NODE_ENV: 'staging' })).toThrow(/MONGODB_URI[\s\S]*PORT|PORT[\s\S]*MONGODB_URI/);
  });

  it('never echoes the received value in the error message', () => {
    try {
      parseEnv({ MONGODB_URI: 'https://user:TOPSECRET@host', JWT_SECRET: 'SHORTSECRET' });
      throw new Error('expected parseEnv to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect(error.message).not.toContain('TOPSECRET');
      expect(error.message).not.toContain('SHORTSECRET');
    }
  });
});

describe('parseEnv: auth settings', () => {
  it('fails when JWT_SECRET is missing', () => {
    expect(() => parseEnv({ MONGODB_URI: VALID_URI })).toThrow(/JWT_SECRET: is required/);
  });

  it('fails when JWT_SECRET is empty (the .env.example placeholder)', () => {
    expect(() => parseEnv({ ...BASE, JWT_SECRET: '' })).toThrow(/JWT_SECRET: must be at least 32 characters/);
  });

  it('fails when JWT_SECRET is 31 characters and accepts 32', () => {
    expect(() => parseEnv({ ...BASE, JWT_SECRET: 'x'.repeat(31) })).toThrow(/JWT_SECRET/);
    expect(parseEnv({ ...BASE, JWT_SECRET: 'x'.repeat(32) }).jwtSecret).toHaveLength(32);
  });

  it.each(['30m', '8h', '1d', '3600s'])('accepts JWT_EXPIRES_IN %s', (value) => {
    expect(parseEnv({ ...BASE, JWT_EXPIRES_IN: value }).jwtExpiresIn).toBe(value);
  });

  it.each(['8 hours', '8', 'h8', '-1h', ''])('rejects JWT_EXPIRES_IN %p', (value) => {
    expect(() => parseEnv({ ...BASE, JWT_EXPIRES_IN: value })).toThrow(/JWT_EXPIRES_IN/);
  });

  it('coerces BCRYPT_ROUNDS and enforces the 4-15 range', () => {
    expect(parseEnv({ ...BASE, BCRYPT_ROUNDS: '4' }).bcryptRounds).toBe(4);
    expect(() => parseEnv({ ...BASE, BCRYPT_ROUNDS: '3' })).toThrow(/BCRYPT_ROUNDS/);
    expect(() => parseEnv({ ...BASE, BCRYPT_ROUNDS: '16' })).toThrow(/BCRYPT_ROUNDS/);
  });

  it('requires at least 10 BCRYPT_ROUNDS in production', () => {
    expect(() => parseEnv({ ...BASE, NODE_ENV: 'production', BCRYPT_ROUNDS: '9' })).toThrow(
      /BCRYPT_ROUNDS: must be at least 10 in production/,
    );
    expect(parseEnv({ ...BASE, NODE_ENV: 'production', BCRYPT_ROUNDS: '10' }).bcryptRounds).toBe(10);
  });

  it('allows low BCRYPT_ROUNDS outside production', () => {
    expect(parseEnv({ ...BASE, NODE_ENV: 'test', BCRYPT_ROUNDS: '4' }).bcryptRounds).toBe(4);
  });
});
