import { z } from "zod";
import { ALL_ORDER_STATUSES } from "../constants/orderStatus.js";
import { addYears, todayInIndia } from "../utils/dates.js";
import { hasAtMostDecimals } from "../utils/units.js";
import { objectIdSchema } from "./common.validators.js";

export const MAX_ORDER_METRES = 1_000_000;
export const MAX_DEADLINE_YEARS = 2;

const quantityMetresSchema = z
  .number()
  .positive()
  .max(MAX_ORDER_METRES)
  // Stored as integer centimetres.
  .refine((value) => hasAtMostDecimals(value, 2), {
    error: "must have at most 2 decimal places",
  });

// A calendar date, compared with today in India. Evaluated per request (not at import time).
const requiredBySchema = z.iso
  .date({ error: "must be a date in YYYY-MM-DD format" })
  .refine((date) => date > todayInIndia(), { error: "must be after today" })
  .refine((date) => date <= addYears(todayInIndia(), MAX_DEADLINE_YEARS), {
    error: `must be within ${MAX_DEADLINE_YEARS} years`,
  });

const orderFields = {
  productId: objectIdSchema,
  quantityMetres: quantityMetresSchema,
  requiredBy: requiredBySchema,
  buyerNotes: z.string().trim().min(1).max(500).optional(),
};

/*
 * Two strict schemas, chosen by role. Neither accepts status, orderNumber, prices, yarn figures,
 * createdBy or any other server-owned field: sending one is a 400, not silently ignored.
 */
// A BUYER orders for their own company: buyerId comes from the account and may not be sent.
export const buyerCreateOrderBodySchema = z.strictObject(orderFields);
// An ADMIN orders on a buyer's behalf and must say which buyer.
export const adminCreateOrderBodySchema = z.strictObject({
  ...orderFields,
  buyerId: objectIdSchema,
});

export const listOrdersQuerySchema = z.object({
  status: z.enum(ALL_ORDER_STATUSES).optional(),
  productId: objectIdSchema.optional(),
  // Ignored for BUYER: a buyer always sees only their own company's orders.
  buyerId: objectIdSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const orderIdParamsSchema = z.object({ id: objectIdSchema });

export const statusChangeBodySchema = z.strictObject({
  reason: z.string().trim().min(5).max(500),
});
