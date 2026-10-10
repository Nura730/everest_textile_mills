import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

const MIN_PRODUCTION_BCRYPT_ROUNDS = 10;

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    MONGODB_URI: z
      .string({ error: 'is required' })
      .regex(/^mongodb(\+srv)?:\/\//, { error: 'must start with mongodb:// or mongodb+srv://' }),
    LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
      .pipe(z.array(z.url({ error: 'must be a comma-separated list of URLs' })).min(1)),
    JSON_BODY_LIMIT: z.string().default('100kb'),
    // HS256 secret. Short secrets can be brute-forced offline from any captured token.
    JWT_SECRET: z
      .string({ error: 'is required' })
      .min(32, { error: 'must be at least 32 characters (see .env.example for a generator command)' }),
    // One shift by default. No refresh tokens: re-login after expiry.
    JWT_EXPIRES_IN: z
      .string()
      .regex(/^\d+[smhd]$/, { error: 'must look like 30m, 8h or 1d' })
      .default('8h'),
    // ~250ms per hash at 12. Tests use 4 for speed; production must not go below 10.
    BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
    // Key-encryption key for the per-user RSA signing keys (32 random bytes, base64). Without it the
    // server cannot sign approvals (QC, dispatch) and refuses them; required in production.
    SIGNING_KEY_ENCRYPTION_KEY: z
      .string()
      .refine((value) => Buffer.from(value, 'base64').length === 32, { error: 'must be 32 random bytes, base64-encoded (see .env.example)' })
      .optional(),
    // RSA modulus for newly generated signing keys. 3072 by default (NIST SP 800-57: beyond 2030).
    SIGNING_RSA_BITS: z.coerce.number().int().refine((bits) => [2048, 3072, 4096].includes(bits), { error: 'must be 2048, 3072 or 4096' }).default(3072),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.BCRYPT_ROUNDS < MIN_PRODUCTION_BCRYPT_ROUNDS) {
      ctx.addIssue({
        code: 'custom',
        path: ['BCRYPT_ROUNDS'],
        message: `must be at least ${MIN_PRODUCTION_BCRYPT_ROUNDS} in production`,
      });
    }
    if (env.NODE_ENV === 'production' && !env.SIGNING_KEY_ENCRYPTION_KEY) {
      ctx.addIssue({ code: 'custom', path: ['SIGNING_KEY_ENCRYPTION_KEY'], message: 'is required in production (approvals are cryptographically signed)' });
    }
    if (env.NODE_ENV === 'production' && env.SIGNING_RSA_BITS < 3072) {
      ctx.addIssue({ code: 'custom', path: ['SIGNING_RSA_BITS'], message: 'must be at least 3072 in production' });
    }
  });

export class EnvValidationError extends Error {
  constructor(issues) {
    // Only field names and rule messages, never the received values: they may be secrets.
    const lines = issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    super(`Invalid environment configuration:\n${lines.join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

export function parseEnv(source) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(result.error.issues);
  }

  const env = result.data;
  return Object.freeze({
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    port: env.PORT,
    mongodbUri: env.MONGODB_URI,
    logLevel: env.LOG_LEVEL ?? (env.NODE_ENV === 'test' ? 'silent' : 'info'),
    corsOrigins: Object.freeze(env.CORS_ORIGINS),
    jsonBodyLimit: env.JSON_BODY_LIMIT,
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    bcryptRounds: env.BCRYPT_ROUNDS,
    signingKeyEncryptionKey: env.SIGNING_KEY_ENCRYPTION_KEY ? Buffer.from(env.SIGNING_KEY_ENCRYPTION_KEY, 'base64') : null,
    signingRsaBits: env.SIGNING_RSA_BITS,
  });
}

let cachedConfig;

export function getConfig() {
  if (!cachedConfig) {
    // Tests must be hermetic: never pick up a developer's local .env.
    if (process.env.NODE_ENV !== 'test') {
      dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
    }
    cachedConfig = parseEnv(process.env);
  }
  return cachedConfig;
}
