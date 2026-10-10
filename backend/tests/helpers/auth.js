import { Writable } from 'node:stream';
import { createLogger } from '../../src/config/logger.js';
import { ROLES } from '../../src/constants/roles.js';
import { User } from '../../src/models/User.js';
import { hashPassword } from '../../src/services/password.service.js';
import { signAccessToken } from '../../src/services/token.service.js';

// Test-only credential; never used outside the in-memory database.
export const TEST_PASSWORD = 'Test-Password-123';

let counter = 0;

export async function createTestUser({ role = ROLES.BUYER, password = TEST_PASSWORD, ...overrides } = {}) {
  counter += 1;
  return User.create({
    name: `Test ${role} ${counter}`,
    email: `${role.toLowerCase()}-${counter}@everest.test`,
    passwordHash: await hashPassword(password),
    role,
    ...overrides,
  });
}

export function tokenFor(user) {
  return signAccessToken(user).token;
}

export function bearer(user) {
  return `Bearer ${tokenFor(user)}`;
}

/** A logger that records every JSON line it writes, for leak and context assertions. */
export function captureLogs(level = 'info') {
  const lines = [];
  const raw = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      raw.push(chunk.toString());
      lines.push(JSON.parse(chunk.toString()));
      callback();
    },
  });
  return { lines, raw, logger: createLogger({ level, destination }) };
}
