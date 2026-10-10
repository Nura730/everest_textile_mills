import { z } from 'zod';
import { YARN_MATERIALS } from '../models/YarnLot.js';
import { normalizeCode, toTitleCase } from '../utils/normalize.js';
import { hasAtMostDecimals } from '../utils/units.js';
import { objectIdSchema } from './common.validators.js';

export const MAX_RECEIPT_KG = 100_000;
// Allows a receipt timestamp from a device whose clock runs a little ahead.
const CLOCK_SKEW_MS = 5 * 60 * 1000;

function kilograms({ allowNegative = false } = {}) {
  let schema = z.number().max(MAX_RECEIPT_KG);
  schema = allowNegative ? schema.min(-MAX_RECEIPT_KG) : schema.positive();
  // Stored as integer grams: more than 3 decimals would be silently rounded.
  return schema.refine((value) => hasAtMostDecimals(value, 3), { error: 'must have at most 3 decimal places' });
}

const lotNumberSchema = z
  .string()
  .transform(normalizeCode)
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9/-]{2,39}$/, { error: 'must be 3-40 characters: letters, digits, "/" or "-"' }));

const colourSchema = z
  .string()
  .transform(toTitleCase)
  .pipe(z.string().min(2).max(50).regex(/^[\p{L}][\p{L} -]*$/u, { error: 'must contain only letters, spaces and hyphens' }));

export const receiveLotBodySchema = z.strictObject({
  lotNumber: lotNumberSchema,
  material: z.enum(YARN_MATERIALS),
  colour: colourSchema,
  yarnCount: z.string().trim().min(1).max(20).optional(),
  supplierName: z.string().trim().min(2).max(120),
  quantityKg: kilograms(),
  costPerKgPaise: z.number().int().min(0).max(100_000_000),
  receivedAt: z.iso
    .datetime({ offset: true })
    .transform((value) => new Date(value))
    .refine((date) => date.getTime() <= Date.now() + CLOCK_SKEW_MS, { error: 'cannot be in the future' })
    .optional(),
});

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};

export const listLotsQuerySchema = z.object({
  material: z.enum(YARN_MATERIALS).optional(),
  colour: colourSchema.optional(),
  includeDepleted: z.stringbool().default(false),
  ...pagination,
});

export const lotIdParamsSchema = z.object({ id: objectIdSchema });

export const ledgerQuerySchema = z.object(pagination);

export const yarnSummaryQuerySchema = z.object({
  material: z.enum(YARN_MATERIALS).optional(),
  includeDepleted: z.stringbool().default(false),
});

export const adjustLotBodySchema = z.strictObject({
  deltaKg: kilograms({ allowNegative: true }).refine((value) => value !== 0, { error: 'must not be zero' }),
  reason: z.string().trim().min(5).max(500),
});
