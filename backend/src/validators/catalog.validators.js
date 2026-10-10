import { z } from 'zod';
import { MACHINE_TYPES, WEAVES } from '../constants/production.js';
import { YARN_MATERIALS } from '../models/YarnLot.js';
import { normalizeCode, toTitleCase } from '../utils/normalize.js';
import { emailSchema, objectIdSchema } from './common.validators.js';

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};

const codeSchema = (max) =>
  z
    .string()
    .transform(normalizeCode)
    .pipe(z.string().regex(new RegExp(`^[A-Z0-9][A-Z0-9-]{1,${max - 1}}$`), { error: `must be 2-${max} characters: letters, digits or "-"` }));

const colourSchema = z
  .string()
  .transform(toTitleCase)
  .pipe(z.string().min(2).max(50).regex(/^[\p{L}][\p{L} -]*$/u, { error: 'must contain only letters, spaces and hyphens' }));

// ── Buyers ──────────────────────────────────────────────────────────────────────
export const createBuyerBodySchema = z.strictObject({
  code: codeSchema(20),
  name: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(100).optional(),
  email: emailSchema.optional(),
  phone: z.string().trim().regex(/^\+?[0-9][0-9 -]{6,19}$/, { error: 'must be a phone number' }).optional(),
  address: z.string().trim().min(5).max(300).optional(),
});

export const listBuyersQuerySchema = z.object({
  isActive: z.stringbool().optional(),
  ...pagination,
});

export const idParamsSchema = z.object({ id: objectIdSchema });

// ── Products ────────────────────────────────────────────────────────────────────
export const createProductBodySchema = z
  .strictObject({
    code: codeSchema(30),
    name: z.string().trim().min(2).max(120),
    material: z.enum(YARN_MATERIALS),
    colour: colourSchema,
    weave: z.enum(WEAVES),
    widthCm: z.number().int().min(50).max(400),
    gsm: z.number().int().min(20).max(1000),
    yarnGramsPerMetre: z.number().int().min(1).max(10_000),
    machineType: z.enum(MACHINE_TYPES).default('WEAVING'),
    pricePerMetrePaise: z.number().int().min(1).max(10_000_000),
  })
  .superRefine((product, ctx) => {
    // One metre of fabric weighs gsm × width (in m). The yarn consumed to make it can't be less.
    const fabricGramsPerMetre = Math.floor((product.gsm * product.widthCm) / 100);
    if (product.yarnGramsPerMetre < fabricGramsPerMetre) {
      ctx.addIssue({
        code: 'custom',
        path: ['yarnGramsPerMetre'],
        message: `must be at least ${fabricGramsPerMetre} (the fabric's own weight per metre: gsm × width)`,
      });
    }
  });

export const listProductsQuerySchema = z.object({
  material: z.enum(YARN_MATERIALS).optional(),
  colour: colourSchema.optional(),
  // Honoured for ADMIN only; everyone else always sees active products.
  includeInactive: z.stringbool().default(false),
  ...pagination,
});
