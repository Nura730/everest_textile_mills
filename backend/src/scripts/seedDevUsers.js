import { z } from 'zod';
import { ROLES } from '../constants/roles.js';
import { User } from '../models/User.js';
import { MIN_PASSWORD_LENGTH, hashPassword } from '../services/password.service.js';
import { passwordWithinBcryptLimit } from '../validators/common.validators.js';

export const DEV_USERS = Object.freeze([
  { name: 'Everest Admin', email: 'admin@everest.local', role: ROLES.ADMIN },
  { name: 'Store Keeper', email: 'store@everest.local', role: ROLES.STORE_KEEPER },
  { name: 'Floor Manager', email: 'floor@everest.local', role: ROLES.FLOOR_MANAGER },
  { name: 'QC Inspector', email: 'qc@everest.local', role: ROLES.QC_INSPECTOR },
  { name: 'Buyer Contact', email: 'buyer@everest.local', role: ROLES.BUYER },
]);

export const seedEnvSchema = z.object({
  // No default on purpose: the dev database is on Atlas and reachable from the internet,
  // so a password everyone can read in the repository would be a real credential.
  SEED_PASSWORD: passwordWithinBcryptLimit(
    z.string({ error: 'is required' }).min(MIN_PASSWORD_LENGTH, { error: `must be at least ${MIN_PASSWORD_LENGTH} characters` }),
  ),
});

/**
 * Creates one user per role for local development. Idempotent: an existing email is
 * left untouched (its password is never overwritten), so re-running is always safe.
 * Returns [{ email, role, status: 'created' | 'exists' }]; never returns passwords.
 */
export async function seedDevUsers({ nodeEnv, password }) {
  if (nodeEnv === 'production') {
    throw new Error('seed:dev refuses to run with NODE_ENV=production. Use bootstrap:admin instead.');
  }

  const passwordHash = await hashPassword(password);
  const report = [];
  for (const devUser of DEV_USERS) {
    const result = await User.updateOne(
      { email: devUser.email },
      { $setOnInsert: { ...devUser, passwordHash, createdBy: null } },
      { upsert: true },
    );
    report.push({ email: devUser.email, role: devUser.role, status: result.upsertedCount === 1 ? 'created' : 'exists' });
  }
  return report;
}
