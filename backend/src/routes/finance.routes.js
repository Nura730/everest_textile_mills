import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../constants/roles.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { monthlyStatement, monthlyTrend } from '../services/finance.service.js';
import { sendSuccess } from '../utils/apiResponse.js';

// The owner's month-end statement (/api/finance). Money: ADMIN only.
const router = Router();
const adminOnly = authorize(ROLES.ADMIN);
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, { error: 'must be a month in YYYY-MM format' });

router.get('/monthly', adminOnly, validate({ query: z.object({ month: monthSchema }) }), async (req, res) => sendSuccess(res, await monthlyStatement(req.validated.query.month)));
router.get('/trend', adminOnly, validate({ query: z.object({ months: z.coerce.number().int().min(1).max(24).default(6) }) }), async (req, res) => sendSuccess(res, await monthlyTrend(req.validated.query.months)));

export default router;
