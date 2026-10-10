import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getConfig } from '../config/env.js';

// bcrypt only reads the first 72 BYTES; anything longer would be silently ignored.
// Counted in UTF-8 bytes, not characters: "₹" is 3 bytes.
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_BYTES = 72;

export function passwordByteLength(password) {
  return Buffer.byteLength(password, 'utf8');
}

export async function hashPassword(password) {
  if (passwordByteLength(password) > MAX_PASSWORD_BYTES) {
    // Validators reject this first; this guard stops a future caller from bypassing them.
    throw new RangeError(`Password exceeds ${MAX_PASSWORD_BYTES} bytes`);
  }
  return bcrypt.hash(password, getConfig().bcryptRounds);
}

export function verifyPassword(password, passwordHash) {
  return bcrypt.compare(password, passwordHash);
}

let dummyHashPromise;

/**
 * Burns the same bcrypt time as a real comparison and always returns false.
 * Used when the email does not exist, so response time does not reveal which
 * emails have accounts. The dummy hash is created once, at the configured cost.
 */
export async function verifyAgainstDummyHash(password) {
  dummyHashPromise ??= bcrypt.hash(randomBytes(32).toString('hex'), getConfig().bcryptRounds);
  await bcrypt.compare(password, await dummyHashPromise);
  return false;
}
