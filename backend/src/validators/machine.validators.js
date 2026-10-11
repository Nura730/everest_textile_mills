import { z } from 'zod';
import { ALL_MACHINE_STATUSES, MACHINE_EVENT_TYPES, PROBLEM_CATEGORIES, PROBLEM_SEVERITIES } from '../constants/machines.js';
import { MACHINE_TYPES } from '../constants/production.js';
import { normalizeCode } from '../utils/normalize.js';
import { hasAtMostDecimals } from '../utils/units.js';
import {
  dateFilterSchema,
  expectedUpdatedAtSchema,
  objectIdSchema,
  refineDateRange,
  searchQuerySchema,
} from './common.validators.js';

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
};

const machineCodeSchema = z
  .string()
  .transform(normalizeCode)
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, { error: 'must be 2-20 characters: letters, digits or "-" (e.g. W-03)' }));

// Rated output; stored as integer cm per hour.
const ratedMetresPerHourSchema = z
  .number()
  .positive()
  .max(10_000)
  .refine((value) => hasAtMostDecimals(value, 2), { error: 'must have at most 2 decimal places' });

const nameSchema = z.string().trim().min(2).max(100);
const locationSchema = z.string().trim().min(1).max(100);

export const createMachineBodySchema = z.strictObject({
  code: machineCodeSchema,
  name: nameSchema,
  type: z.enum(MACHINE_TYPES),
  ratedMetresPerHour: ratedMetresPerHourSchema,
  location: locationSchema.optional(),
});

/*
 * Editable: name, rated speed, location. Code and type identify the machine (production history
 * and matching to products depend on them) and are not accepted; status changes only through the
 * maintenance/problem actions. At least one field.
 */
export const updateMachineBodySchema = z
  .strictObject({
    expectedUpdatedAt: expectedUpdatedAtSchema,
    name: nameSchema.optional(),
    ratedMetresPerHour: ratedMetresPerHourSchema.optional(),
    location: locationSchema.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (['name', 'ratedMetresPerHour', 'location'].every((key) => value[key] === undefined)) {
      ctx.addIssue({ code: 'custom', path: [], message: 'must include at least one of: name, ratedMetresPerHour, location' });
    }
  });

export const machineActiveBodySchema = z.strictObject({ isActive: z.boolean() });

export const listMachinesQuerySchema = z.object({
  type: z.enum(MACHINE_TYPES).optional(),
  status: z.enum(ALL_MACHINE_STATUSES).optional(),
  // Code, name or location.
  q: searchQuerySchema,
  // Retired machines are hidden unless asked for.
  isActive: z.stringbool().default(true),
  ...pagination,
});

export const machineIdParamsSchema = z.object({ id: objectIdSchema });
export const problemParamsSchema = z.object({ id: objectIdSchema, eventId: objectIdSchema });

export const maintenanceBodySchema = z.strictObject({ note: z.string().trim().min(1).max(1000).optional() });

// Finishing maintenance records what it cost (paise; 0 allowed when nothing was spent). It is not asked
// at the start because it is usually known only when the work is done.
export const endMaintenanceBodySchema = z.strictObject({
  note: z.string().trim().min(1).max(1000).optional(),
  costPaise: z.number({ error: 'is required (0 if nothing was spent)' }).int().min(0).max(1_000_000_000),
});

export const reportProblemBodySchema = z.strictObject({
  category: z.enum(PROBLEM_CATEGORIES),
  severity: z.enum(PROBLEM_SEVERITIES),
  description: z.string().trim().min(5).max(1000),
  estimatedDowntimeMinutes: z.number().int().min(0).max(60 * 24 * 30).optional(),
  // Pause the run on a RUNNING machine for a non-critical problem (critical always takes it DOWN).
  pauseProduction: z.boolean().optional(),
});

export const resolveProblemBodySchema = z.strictObject({ resolution: z.string().trim().min(5).max(1000) });

export const machineEventsQuerySchema = z
  .object({
    type: z.enum(MACHINE_EVENT_TYPES).optional(),
    from: dateFilterSchema,
    to: dateFilterSchema,
    ...pagination,
  })
  .superRefine(refineDateRange('from', 'to'));
