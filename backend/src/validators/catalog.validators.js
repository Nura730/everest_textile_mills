import { z } from 'zod';
import { MACHINE_TYPES, WEAVES } from '../constants/production.js';
import { YARN_MATERIALS } from '../models/YarnLot.js';
import { normalizeCode, toTitleCase } from '../utils/normalize.js';
import { emailSchema, expectedUpdatedAtSchema, objectIdSchema, searchQuerySchema } from './common.validators.js';

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
const buyerFields = {
  name: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(100),
  email: emailSchema,
  phone: z.string().trim().regex(/^\+?[0-9][0-9 -]{6,19}$/, { error: 'must be a phone number' }),
  address: z.string().trim().min(5).max(300),
};

export const createBuyerBodySchema = z.strictObject({
  code: codeSchema(20),
  name: buyerFields.name,
  contactName: buyerFields.contactName.optional(),
  email: buyerFields.email.optional(),
  phone: buyerFields.phone.optional(),
  address: buyerFields.address.optional(),
});

/** At least one of `keys` must be present, so an edit always says what it changes. */
const requireOneOf = (keys) => (value, ctx) => {
  if (!keys.some((key) => value[key] !== undefined)) {
    ctx.addIssue({ code: 'custom', path: [], message: `must include at least one of: ${keys.join(', ')}` });
  }
};

/*
 * Editing a company: contact details only. `code` (its stable identifier), status (own endpoint),
 * createdBy and timestamps are not accepted: strictObject turns them into a 400. Optional contact
 * fields can be cleared with null.
 */
export const updateBuyerBodySchema = z
  .strictObject({
    expectedUpdatedAt: expectedUpdatedAtSchema,
    name: buyerFields.name.optional(),
    contactName: buyerFields.contactName.nullable().optional(),
    email: buyerFields.email.nullable().optional(),
    phone: buyerFields.phone.nullable().optional(),
    address: buyerFields.address.nullable().optional(),
  })
  .superRefine(requireOneOf(['name', 'contactName', 'email', 'phone', 'address']));

export const updateStatusBodySchema = z.strictObject({ isActive: z.boolean() });

export const listBuyersQuerySchema = z.object({
  isActive: z.stringbool().optional(),
  // Code or name.
  q: searchQuerySchema,
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

/*
 * Editing a fabric: name, price and yarn consumption. code, material, colour, weave, width, GSM and
 * machine type define WHICH fabric it is (and the code encodes them), so they are not editable:
 * a different fabric is a new product. Existing orders keep their own snapshot.
 * The yarn >= fabric-weight rule needs the stored width and GSM, so the service checks it.
 */
export const updateProductBodySchema = z
  .strictObject({
    expectedUpdatedAt: expectedUpdatedAtSchema,
    name: z.string().trim().min(2).max(120).optional(),
    pricePerMetrePaise: z.number().int().min(1).max(10_000_000).optional(),
    yarnGramsPerMetre: z.number().int().min(1).max(10_000).optional(),
  })
  .superRefine(requireOneOf(['name', 'pricePerMetrePaise', 'yarnGramsPerMetre']));

export const listProductsQuerySchema = z.object({
  material: z.enum(YARN_MATERIALS).optional(),
  colour: colourSchema.optional(),
  weave: z.enum(WEAVES).optional(),
  // Code or name.
  q: searchQuerySchema,
  // ADMIN only (everyone else always sees active products): includeInactive=true lists both;
  // isActive=true|false lists exactly one status and takes precedence.
  includeInactive: z.stringbool().default(false),
  isActive: z.stringbool().optional(),
  ...pagination,
});
