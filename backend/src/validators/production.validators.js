import { z } from 'zod';
import { ALL_RUN_STATUSES } from '../constants/production.js';
import { hasAtMostDecimals } from '../utils/units.js';
import { objectIdSchema } from './common.validators.js';

const metres = z
  .number()
  .positive()
  .max(1_000_000)
  .refine((value) => hasAtMostDecimals(value, 2), { error: 'must have at most 2 decimal places' });

export const planRunBodySchema = z.strictObject({
  orderId: objectIdSchema,
  machineId: objectIdSchema,
  targetMetres: metres,
  plannedStartAt: z.iso.datetime({ offset: true }).optional(),
  note: z.string().trim().min(1).max(500).optional(),
});

export const listRunsQuerySchema = z.object({
  orderId: objectIdSchema.optional(),
  machineId: objectIdSchema.optional(),
  status: z.enum(ALL_RUN_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const runIdParamsSchema = z.object({ id: objectIdSchema });

export const emptyBodySchema = z.strictObject({});
export const reasonBodySchema = z.strictObject({ reason: z.string().trim().min(5).max(500) });
// Completing BELOW the run's target is a deliberate partial completion: it needs the reason for the shortfall.
export const completeRunBodySchema = z.strictObject({
  note: z.string().trim().min(1).max(500).optional(),
  shortfallReason: z.string().trim().min(5).max(500).optional(),
});

export const recordRollBodySchema = z.strictObject({
  // One roll; stored as integer cm. A roll is at most 10,000 m.
  lengthMetres: metres.max(10_000),
  // Optional weighed mass, stored as integer grams.
  weightKg: z
    .number()
    .positive()
    .max(100_000)
    .refine((value) => hasAtMostDecimals(value, 3), { error: 'must have at most 3 decimal places' })
    .optional(),
});
