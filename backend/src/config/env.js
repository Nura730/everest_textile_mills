import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

const envSchema = z.object({
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
