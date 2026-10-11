import { Router } from 'express';
import { ROLES } from '../constants/roles.js';
import * as productionController from '../controllers/production.controller.js';
import { authorize } from '../middleware/authorize.js';
import { requireIdempotencyKey } from '../middleware/idempotencyKey.js';
import { validate } from '../middleware/validate.js';
import {
  completeRunBodySchema,
  emptyBodySchema,
  listRunsQuerySchema,
  planRunBodySchema,
  reasonBodySchema,
  recordRollBodySchema,
  runIdParamsSchema,
} from '../validators/production.validators.js';

// Mounted at /api/production-runs, after authenticate.
//  - viewing: every internal role (the store issues yarn to runs, QC inspects their rolls);
//  - planning and running production: FLOOR_MANAGER and ADMIN (instruction.md §2).
const router = Router();
const viewers = authorize(ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.ADMIN);
const floor = authorize(ROLES.FLOOR_MANAGER, ROLES.ADMIN);
const byId = { params: runIdParamsSchema };

router.get('/', viewers, validate({ query: listRunsQuerySchema }), productionController.listRuns);
router.post('/', floor, requireIdempotencyKey, validate({ body: planRunBodySchema }), productionController.planRun);
router.get('/:id', viewers, validate(byId), productionController.getRun);
router.post('/:id/start', floor, requireIdempotencyKey, validate({ ...byId, body: emptyBodySchema }), productionController.startRun);
router.post('/:id/pause', floor, requireIdempotencyKey, validate({ ...byId, body: reasonBodySchema }), productionController.pauseRun);
router.post('/:id/resume', floor, requireIdempotencyKey, validate({ ...byId, body: emptyBodySchema }), productionController.resumeRun);
router.post('/:id/complete', floor, requireIdempotencyKey, validate({ ...byId, body: completeRunBodySchema }), productionController.completeRun);
router.post('/:id/cancel', floor, requireIdempotencyKey, validate({ ...byId, body: reasonBodySchema }), productionController.cancelRun);
// Correct a run completed by mistake (explicit, narrow, audited; see production.service reopenRun).
router.post('/:id/reopen', floor, requireIdempotencyKey, validate({ ...byId, body: reasonBodySchema }), productionController.reopenRun);
router.post('/:id/rolls', floor, requireIdempotencyKey, validate({ ...byId, body: recordRollBodySchema }), productionController.recordRoll);

export default router;
