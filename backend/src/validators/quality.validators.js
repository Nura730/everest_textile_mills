import { z } from 'zod';
import { ROLL_STATUS } from '../constants/production.js';
import { ALL_QC_RESULTS, DEFECT_SEVERITIES, DEFECT_TYPES } from '../constants/quality.js';
import { objectIdSchema, searchQuerySchema } from './common.validators.js';

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};

export const rollIdParamsSchema = z.object({ id: objectIdSchema });

export const listRollsQuerySchema = z.object({
  status: z.enum(Object.values(ROLL_STATUS)).optional(),
  orderId: objectIdSchema.optional(),
  machineId: objectIdSchema.optional(),
  runId: objectIdSchema.optional(),
  // Roll, order, run number or machine code.
  q: searchQuerySchema,
  ...pagination,
});

/**
 * A drawn signature: the signer ticks the statement (accepted: true) and draws on the pad (a small PNG
 * data URL, at most ~60 kB so it fits the request limit).
 */
/*
 * The signer's explicit consent to the statement (required). The approval itself is signed
 * cryptographically on the server with the signer's own key; `image` is an optional handwritten
 * acknowledgment kept as visual evidence only.
 */
export const signatureInputSchema = z.strictObject({
  accepted: z.literal(true, { error: 'the statement must be accepted' }),
  image: z
    .string()
    .max(60_000, { error: 'signature image is too large' })
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, { error: 'must be a PNG data URL from the signature pad' })
    .optional(),
});

export const inspectRollBodySchema = z.strictObject({
  result: z.enum(ALL_QC_RESULTS),
  defects: z
    .array(z.strictObject({ type: z.enum(DEFECT_TYPES), severity: z.enum(DEFECT_SEVERITIES), notes: z.string().trim().min(1).max(500).optional() }))
    .max(20)
    .default([]),
  notes: z.string().trim().min(1).max(1000).optional(),
  signature: signatureInputSchema.optional(),
});

export const reworkDoneBodySchema = z.strictObject({ note: z.string().trim().min(1).max(500).optional() });

export const listInspectionsQuerySchema = z.object({
  orderId: objectIdSchema.optional(),
  machineId: objectIdSchema.optional(),
  result: z.enum(ALL_QC_RESULTS).optional(),
  ...pagination,
});
