import { z } from 'zod';
import { INVENTORY_TRANSACTION_TYPES } from '../models/InventoryTransaction.js';
import { YARN_MATERIALS } from '../models/YarnLot.js';
import { normalizeCode, toTitleCase } from '../utils/normalize.js';
import { hasAtMostDecimals } from '../utils/units.js';
import { expectedUpdatedAtSchema, dateFilterSchema, objectIdSchema, refineDateRange } from './common.validators.js';

export const MAX_RECEIPT_KG = 100_000;
// Allows a receipt timestamp from a device whose clock runs a little ahead.
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export function kilograms({ allowNegative = false } = {}) {
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

/*
 * Editing a lot's descriptive details (store keeper, admin). Quantities are NOT editable here: stock
 * only changes through the ledger (receipt, adjustment, reservation, issue, return).
 */
export const updateLotBodySchema = z
  .strictObject({
    expectedUpdatedAt: expectedUpdatedAtSchema,
    lotNumber: lotNumberSchema.optional(),
    material: z.enum(YARN_MATERIALS).optional(),
    colour: colourSchema.optional(),
    yarnCount: z.string().trim().min(1).max(20).nullable().optional(),
    supplierName: z.string().trim().min(2).max(120).optional(),
    costPerKgPaise: z.number().int().min(0).max(100_000_000).optional(),
  })
  .superRefine((value, ctx) => {
    if (['lotNumber', 'material', 'colour', 'yarnCount', 'supplierName', 'costPerKgPaise'].every((key) => value[key] === undefined)) {
      ctx.addIssue({ code: 'custom', path: [], message: 'must include at least one field to change' });
    }
  });

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

export const ledgerQuerySchema = z
  .object({
    type: z.enum(INVENTORY_TRANSACTION_TYPES).optional(),
    // Movements made for one order (reservation, issue, return, release).
    orderId: objectIdSchema.optional(),
    // Movement date range (Indian calendar days, inclusive).
    from: dateFilterSchema,
    to: dateFilterSchema,
    ...pagination,
  })
  .superRefine(refineDateRange('from', 'to'));

export const yarnSummaryQuerySchema = z.object({
  material: z.enum(YARN_MATERIALS).optional(),
  includeDepleted: z.stringbool().default(false),
});

export const adjustLotBodySchema = z.strictObject({
  deltaKg: kilograms({ allowNegative: true }).refine((value) => value !== 0, { error: 'must not be zero' }),
  reason: z.string().trim().min(5).max(500),
});
