import { User, toPublicUser } from '../models/User.js';
import { hashPassword } from './password.service.js';

/**
 * Business rule: only an ADMIN creates accounts (no public registration), including
 * other ADMINs. The creator is recorded in createdBy for accountability.
 * A duplicate email is rejected by the unique index (409 DUPLICATE_RESOURCE), which is
 * race-safe: two simultaneous requests cannot both pass a "does it exist?" pre-check.
 */
export async function createUser({ name, email, password, role }, actor) {
  const user = await User.create({
    name,
    email,
    passwordHash: await hashPassword(password),
    role,
    createdBy: actor.id,
  });
  return toPublicUser(user);
}
