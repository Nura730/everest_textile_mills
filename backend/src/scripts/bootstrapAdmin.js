import { z } from 'zod';
import { ROLES } from '../constants/roles.js';
import { User } from '../models/User.js';
import { MIN_PASSWORD_LENGTH, hashPassword } from '../services/password.service.js';
import { emailSchema, passwordWithinBcryptLimit } from '../validators/common.validators.js';

export const bootstrapEnvSchema = z.object({
  BOOTSTRAP_ADMIN_NAME: z.string({ error: 'is required' }).trim().min(2).max(100),
  BOOTSTRAP_ADMIN_EMAIL: emailSchema,
  BOOTSTRAP_ADMIN_PASSWORD: passwordWithinBcryptLimit(
    z.string({ error: 'is required' }).min(MIN_PASSWORD_LENGTH, { error: `must be at least ${MIN_PASSWORD_LENGTH} characters` }),
  ),
});

export class BootstrapRefusedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BootstrapRefusedError';
  }
}

/**
 * Creates the first ADMIN. This is how a fresh (including production) database gets its
 * first account, since only admins can create users and there is no public registration.
 *
 * Refuses when an ACTIVE admin already exists: after that, admins are created through
 * the API, where they are attributed (createdBy). It still works when only deactivated
 * admins exist, as a recovery path; only someone with server and .env access can run it.
 * It never promotes an existing non-admin account.
 */
export async function bootstrapAdmin({ name, email, password }) {
  if (await User.exists({ role: ROLES.ADMIN, isActive: true })) {
    throw new BootstrapRefusedError('An active admin already exists. Create further admins through POST /api/users.');
  }
  if (await User.exists({ email })) {
    throw new BootstrapRefusedError(`An account with this email already exists; it will not be promoted to admin.`);
  }

  const admin = await User.create({
    name,
    email,
    passwordHash: await hashPassword(password),
    role: ROLES.ADMIN,
    createdBy: null,
  });
  return { email: admin.email, role: admin.role };
}
