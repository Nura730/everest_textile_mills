import { z } from 'zod';
import { ALL_ROLES } from '../constants/roles.js';
import { MIN_PASSWORD_LENGTH } from '../services/password.service.js';
import { emailSchema, passwordWithinBcryptLimit } from './common.validators.js';

// strictObject: unknown keys (isActive, tokenVersion, passwordHash, createdBy, ...) are
// rejected with 400 rather than silently dropped. Blocks mass assignment explicitly.
export const createUserBodySchema = z.strictObject({
  name: z.string().trim().min(2).max(100),
  email: emailSchema,
  // Length over composition rules (NIST SP 800-63B); upper bound is bcrypt's 72 bytes.
  password: passwordWithinBcryptLimit(z.string().min(MIN_PASSWORD_LENGTH)),
  role: z.enum(ALL_ROLES),
});
