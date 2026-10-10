import { z } from 'zod';
import { ALL_ROLES } from '../constants/roles.js';
import { MIN_PASSWORD_LENGTH } from '../services/password.service.js';
import { emailSchema, objectIdSchema, passwordWithinBcryptLimit } from './common.validators.js';

// strictObject: unknown keys (isActive, tokenVersion, passwordHash, createdBy, ...) are
// rejected with 400 rather than silently dropped. Blocks mass assignment explicitly.
export const createUserBodySchema = z.strictObject({
  name: z.string().trim().min(2).max(100),
  email: emailSchema,
  // Length over composition rules (NIST SP 800-63B); upper bound is bcrypt's 72 bytes.
  password: passwordWithinBcryptLimit(z.string().min(MIN_PASSWORD_LENGTH)),
  role: z.enum(ALL_ROLES),
});

export const listUsersQuerySchema = z.object({
  role: z.enum(ALL_ROLES).optional(),
  // stringbool: "true"/"false" (and 1/0, yes/no). z.coerce.boolean would turn "false" into true.
  isActive: z.stringbool().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const userIdParamsSchema = z.object({ id: objectIdSchema });

export const updateUserStatusBodySchema = z.strictObject({
  isActive: z.boolean(),
});
