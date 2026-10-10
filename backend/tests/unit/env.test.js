import { parseEnv, EnvValidationError } from '../../src/config/env.js';

const VALID_URI = 'mongodb+srv://user:s3cret@cluster.example.net/everest';

describe('parseEnv', () => {
  it('applies defaults when only MONGODB_URI is given', () => {
    const config = parseEnv({ MONGODB_URI: VALID_URI });

    expect(config).toMatchObject({
      nodeEnv: 'development',
      port: 4000,
      mongodbUri: VALID_URI,
      logLevel: 'info',
      corsOrigins: ['http://localhost:5173'],
      jsonBodyLimit: '100kb',
    });
  });

  it('coerces PORT and splits CORS_ORIGINS', () => {
    const config = parseEnv({
      MONGODB_URI: 'mongodb://localhost:27017/everest',
      PORT: '5050',
      CORS_ORIGINS: 'http://localhost:5173, https://everest.example.com',
    });

    expect(config.port).toBe(5050);
    expect(config.corsOrigins).toEqual(['http://localhost:5173', 'https://everest.example.com']);
  });

  it('defaults LOG_LEVEL to silent in test', () => {
    expect(parseEnv({ MONGODB_URI: VALID_URI, NODE_ENV: 'test' }).logLevel).toBe('silent');
  });

  it('returns a frozen object', () => {
    const config = parseEnv({ MONGODB_URI: VALID_URI });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.corsOrigins)).toBe(true);
  });

  it('fails when MONGODB_URI is missing', () => {
    expect(() => parseEnv({})).toThrow(EnvValidationError);
    expect(() => parseEnv({})).toThrow(/MONGODB_URI: is required/);
  });

  it('fails when MONGODB_URI is not a mongodb URI', () => {
    expect(() => parseEnv({ MONGODB_URI: 'postgres://x' })).toThrow(/MONGODB_URI: must start with/);
  });

  it.each(['0', '70000', 'abc', '40.5'])('fails for invalid PORT %s', (port) => {
    expect(() => parseEnv({ MONGODB_URI: VALID_URI, PORT: port })).toThrow(/PORT/);
  });

  it('fails for an unknown NODE_ENV', () => {
    expect(() => parseEnv({ MONGODB_URI: VALID_URI, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('fails for a non-URL CORS origin', () => {
    expect(() => parseEnv({ MONGODB_URI: VALID_URI, CORS_ORIGINS: 'not a url' })).toThrow(/CORS_ORIGINS/);
  });

  it('reports every invalid field at once', () => {
    expect(() => parseEnv({ PORT: 'abc', NODE_ENV: 'staging' })).toThrow(/MONGODB_URI[\s\S]*PORT|PORT[\s\S]*MONGODB_URI/);
  });

  it('never echoes the received value in the error message', () => {
    try {
      parseEnv({ MONGODB_URI: 'https://user:TOPSECRET@host' });
      throw new Error('expected parseEnv to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect(error.message).not.toContain('TOPSECRET');
    }
  });
});
