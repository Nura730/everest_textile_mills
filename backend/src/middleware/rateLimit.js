import { MemoryStore, ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { AppError } from '../utils/AppError.js';

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
// Failed attempts per (IP, email) pair: slows password guessing on one account.
export const LOGIN_ACCOUNT_LIMIT = 5;
// All attempts per IP: a backstop against spraying many emails from one machine.
// Deliberately generous: every floor tablet shares the factory's single public IP.
export const LOGIN_IP_LIMIT = 100;

/*
 * Known limits (documented in the README):
 *  - In-memory store: counts reset on restart and are per process. One process is fine
 *    for this deployment; several processes would need a shared store (e.g. Redis).
 *  - Behind a reverse proxy, Express must be told to trust it ("trust proxy"),
 *    otherwise every request appears to come from the proxy's IP.
 */
const accountStore = new MemoryStore();
const ipStore = new MemoryStore();

function rejectWithEnvelope(req, res, next) {
  const retryAfterSeconds = Math.max(1, Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000));
  res.set('Retry-After', String(retryAfterSeconds));
  next(
    new AppError('TOO_MANY_REQUESTS', 'Too many login attempts. Please wait and try again.', {
      details: { retryAfterSeconds },
    }),
  );
}

const commonOptions = {
  windowMs: LOGIN_WINDOW_MS,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: rejectWithEnvelope,
};

/** Runs before validation: counts every attempt from an IP. */
export const loginIpLimiter = rateLimit({
  ...commonOptions,
  identifier: 'login-ip',
  limit: LOGIN_IP_LIMIT,
  store: ipStore,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
});

/**
 * Runs after validation, so the email is already trimmed and lowercased: "A@x.com" and
 * "a@x.com " share one counter. Successful logins are not counted, so a worker who
 * mistypes once and then gets it right is not penalised.
 */
export const loginAccountLimiter = rateLimit({
  ...commonOptions,
  identifier: 'login-account',
  limit: LOGIN_ACCOUNT_LIMIT,
  store: accountStore,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${req.validated.body.email}`,
});

/** Test helper: the stores live for the whole process, so tests reset them explicitly. */
export async function resetLoginRateLimits() {
  await Promise.all([accountStore.resetAll(), ipStore.resetAll()]);
}
