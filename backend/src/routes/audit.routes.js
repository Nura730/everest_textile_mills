import { Router } from 'express';
import { z } from 'zod';
import { ALL_ROLES, ROLES } from '../constants/roles.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import * as audit from '../services/audit.service.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { requestContext } from '../utils/requestContext.js';
import { dateFilterSchema, objectIdSchema, refineDateRange } from '../validators/common.validators.js';

// Mounted at /api/audit. Every role reads the trail; the service limits what each role sees.
const router = Router();

const listQuery = z
  .object({
    actorId: objectIdSchema.optional(),
    actorRole: z.enum(ALL_ROLES).optional(),
    orderId: objectIdSchema.optional(),
    machineId: objectIdSchema.optional(),
    action: z.string().trim().regex(/^[A-Z_]{3,60}$/, { error: 'must be an action name' }).optional(),
    entityType: z.string().trim().regex(/^[A-Za-z]{2,40}$/).optional(),
    from: dateFilterSchema,
    to: dateFilterSchema,
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .superRefine(refineDateRange('from', 'to'));

router.get('/', authorize(...ALL_ROLES), validate({ query: listQuery }), async (req, res) => {
  const { entries, meta } = await audit.listAudit(req.validated.query, req.user);
  sendSuccess(res, { entries }, { meta });
});
router.get('/actions', authorize(ROLES.ADMIN), async (req, res) => sendSuccess(res, { actions: await audit.listAuditActions() }));
router.post(
  '/:id/corrections',
  authorize(ROLES.ADMIN),
  validate({ params: z.object({ id: objectIdSchema }), body: z.strictObject({ note: z.string().trim().min(5).max(1000) }) }),
  async (req, res) => sendSuccess(res, { entry: await audit.correctAudit(req.validated.params.id, req.validated.body, requestContext(req)) }, { status: 201 }),
);

export default router;
