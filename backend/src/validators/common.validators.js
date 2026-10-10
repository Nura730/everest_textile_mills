import { z } from 'zod';
import { MAX_PASSWORD_BYTES, passwordByteLength } from '../services/password.service.js';

// Trimmed and lowercased before validation, matching how the User model stores it.
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/, { error: 'must be a valid id' });

/** Rejects passwords bcrypt would silently truncate. Counted in UTF-8 bytes. */
export function passwordWithinBcryptLimit(schema) {
  return schema.refine((value) => passwordByteLength(value) <= MAX_PASSWORD_BYTES, {
    error: `must be at most ${MAX_PASSWORD_BYTES} bytes`,
  });
}
