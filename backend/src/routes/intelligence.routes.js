import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../constants/roles.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { insightsOverview, orderInsight } from '../services/intelligence.service.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { objectIdSchema } from '../validators/common.validators.js';

// Mounted at /api/intelligence. Delivery risk and recommendations are for the people who can act on
// them: the owner, the floor (machines and runs) and the store (yarn). Buyers see only the plain
// delivery outlook on their order timeline.
const router = Router();
const planners = authorize(ROLES.ADMIN, ROLES.FLOOR_MANAGER, ROLES.STORE_KEEPER);

router.get('/overview', planners, async (req, res) => sendSuccess(res, await insightsOverview()));
router.get('/orders/:id', planners, validate({ params: z.object({ id: objectIdSchema }) }), async (req, res) => sendSuccess(res, await orderInsight(req.validated.params.id)));

export default router;
