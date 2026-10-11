import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../constants/roles.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { productionReport, todaySummary } from '../services/report.service.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { refineDateRange } from '../validators/common.validators.js';

// Production reports (/api/reports): output per machine, shift and day; defects. No money.
const router = Router();
const viewers = authorize(ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.ADMIN);
const date = z.iso.date({ error: 'must be a date in YYYY-MM-DD format' });

router.get('/production', viewers, validate({ query: z.object({ from: date, to: date }).superRefine(refineDateRange('from', 'to')) }), async (req, res) => sendSuccess(res, await productionReport(req.validated.query)));
router.get('/today', authorize(ROLES.FLOOR_MANAGER, ROLES.ADMIN), async (req, res) => sendSuccess(res, await todaySummary()));

export default router;
