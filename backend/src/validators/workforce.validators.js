import { z } from 'zod';
import { ATTENDANCE_STATUS, DEPARTMENTS, WAGE_BASIS } from '../constants/workforce.js';
import { normalizeCode } from '../utils/normalize.js';
import { expectedUpdatedAtSchema, objectIdSchema, refineDateRange, searchQuerySchema } from './common.validators.js';

const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(100),
};
const dateSchema = z.iso.date({ error: 'must be a date in YYYY-MM-DD format' });
const ratePaiseSchema = z.number().int().min(0).max(10_000_000);
// Hours worked: up to 24, at most 2 decimals (stored as whole minutes).
const hoursSchema = z
  .number()
  .positive()
  .max(24)
  .refine((v) => Math.round(v * 100) === v * 100, { error: 'must have at most 2 decimal places' });

export const workerIdParamsSchema = z.object({ id: objectIdSchema });

export const listWorkersQuerySchema = z.object({
  q: searchQuerySchema,
  department: z.enum(DEPARTMENTS).optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  ...pagination,
});

export const createWorkerBodySchema = z.strictObject({
  code: z
    .string()
    .transform(normalizeCode)
    .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9-]{1,19}$/, { error: 'must be 2-20 characters: letters, digits or "-" (e.g. WK-014)' })),
  name: z.string().trim().min(2).max(120),
  department: z.enum(DEPARTMENTS),
  wageBasis: z.enum(Object.values(WAGE_BASIS)),
  ratePaise: ratePaiseSchema,
});

export const updateWorkerBodySchema = z
  .strictObject({
    name: z.string().trim().min(2).max(120).optional(),
    department: z.enum(DEPARTMENTS).optional(),
    wageBasis: z.enum(Object.values(WAGE_BASIS)).optional(),
    ratePaise: ratePaiseSchema.optional(),
    isActive: z.boolean().optional(),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .refine((b) => Object.keys(b).some((k) => k !== 'expectedUpdatedAt'), { error: 'change at least one field' });

export const recordAttendanceBodySchema = z.strictObject({
  workerId: objectIdSchema,
  date: dateSchema,
  status: z.enum(Object.values(ATTENDANCE_STATUS)),
  hours: hoursSchema.optional(),
  note: z.string().trim().min(1).max(500).optional(),
});

export const attendanceIdParamsSchema = z.object({ id: objectIdSchema });

export const correctAttendanceBodySchema = z
  .strictObject({
    status: z.enum(Object.values(ATTENDANCE_STATUS)).optional(),
    hours: hoursSchema.optional(),
    reason: z.string().trim().min(5).max(500),
    expectedUpdatedAt: expectedUpdatedAtSchema,
  })
  .refine((b) => b.status !== undefined || b.hours !== undefined, { error: 'give the corrected status or hours' });

export const listAttendanceQuerySchema = z
  .object({
    date: dateSchema.optional(),
    from: dateSchema.optional(),
    to: dateSchema.optional(),
    workerId: objectIdSchema.optional(),
    department: z.enum(DEPARTMENTS).optional(),
    status: z.enum(Object.values(ATTENDANCE_STATUS)).optional(),
    ...pagination,
  })
  .superRefine(refineDateRange('from', 'to'));

export const dayRegisterQuerySchema = z.object({ date: dateSchema, department: z.enum(DEPARTMENTS).optional() });

export const wageSummaryQuerySchema = z.object({ from: dateSchema, to: dateSchema, department: z.enum(DEPARTMENTS).optional() });
