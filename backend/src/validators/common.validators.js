import { z } from 'zod';
import { MAX_PASSWORD_BYTES, passwordByteLength } from '../services/password.service.js';

// Trimmed and lowercased before validation, matching how the User model stores it.
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

export const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/, { error: 'must be a valid id' });

/** Free-text list search. Blank means "no search"; the text is matched literally (utils/search.js). */
export const searchQuerySchema = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((value) => value || undefined);

/** A calendar date filter ("YYYY-MM-DD"). */
export const dateFilterSchema = z.iso.date({ error: 'must be a date in YYYY-MM-DD format' }).optional();

/** For superRefine: an issue when a from/to date pair is reversed. */
export function refineDateRange(fromKey, toKey) {
  return (value, ctx) => {
    if (value[fromKey] && value[toKey] && value[fromKey] > value[toKey]) {
      ctx.addIssue({ code: 'custom', path: [toKey], message: `must be on or after ${fromKey}` });
    }
  };
}

/**
 * Optimistic concurrency for edit forms: the client sends the updatedAt it loaded, and the save is
 * refused with 409 CONFLICT if the record changed since.
 */
export const expectedUpdatedAtSchema = z.iso.datetime({ offset: true, error: 'must be the updatedAt timestamp of the record being edited' });

/** Rejects passwords bcrypt would silently truncate. Counted in UTF-8 bytes. */
export function passwordWithinBcryptLimit(schema) {
  return schema.refine((value) => passwordByteLength(value) <= MAX_PASSWORD_BYTES, {
    error: `must be at most ${MAX_PASSWORD_BYTES} bytes`,
  });
}
