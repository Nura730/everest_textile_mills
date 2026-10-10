import { Router } from 'express';
import { ROLES } from '../constants/roles.js';
import { authorize } from '../middleware/authorize.js';
import { requireIdempotencyKey } from '../middleware/idempotencyKey.js';
import { validate } from '../middleware/validate.js';
import * as quality from '../services/quality.service.js';
import { sendIdempotent, sendSuccess } from '../utils/apiResponse.js';
import { requestContext } from '../utils/requestContext.js';
import {
  inspectRollBodySchema,
  listInspectionsQuerySchema,
  listRollsQuerySchema,
  reworkDoneBodySchema,
  rollIdParamsSchema,
} from '../validators/quality.validators.js';

// Rolls (mounted at /api/rolls) and QC (/api/qc), after authenticate.
//  - viewing rolls and their trace: every internal role;
//  - inspecting: QC_INSPECTOR and ADMIN; finishing rework: FLOOR_MANAGER and ADMIN.
// Thin handlers: the services own the rules.
const staff = authorize(ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.ADMIN);
const inspectors = authorize(ROLES.QC_INSPECTOR, ROLES.ADMIN);
const floor = authorize(ROLES.FLOOR_MANAGER, ROLES.ADMIN);
const qcViewers = authorize(ROLES.QC_INSPECTOR, ROLES.FLOOR_MANAGER, ROLES.ADMIN);

export const rollRoutes = Router();
rollRoutes.get('/', staff, validate({ query: listRollsQuerySchema }), async (req, res) => {
  const { rolls, meta } = await quality.listRolls(req.validated.query);
  sendSuccess(res, { rolls }, { meta });
});
rollRoutes.get('/:id', staff, validate({ params: rollIdParamsSchema }), async (req, res) => {
  sendSuccess(res, await quality.traceRoll(req.validated.params.id, req.user));
});
rollRoutes.post(
  '/:id/inspections',
  inspectors,
  requireIdempotencyKey,
  validate({ params: rollIdParamsSchema, body: inspectRollBodySchema }),
  async (req, res) => sendIdempotent(res, await quality.inspectRoll(req.validated.params.id, req.validated.body, requestContext(req))),
);
rollRoutes.post(
  '/:id/rework-done',
  floor,
  requireIdempotencyKey,
  validate({ params: rollIdParamsSchema, body: reworkDoneBodySchema }),
  async (req, res) => sendIdempotent(res, await quality.completeRework(req.validated.params.id, req.validated.body, requestContext(req))),
);

export const qcRoutes = Router();
qcRoutes.get('/inspections', qcViewers, validate({ query: listInspectionsQuerySchema }), async (req, res) => {
  const { inspections, meta } = await quality.listInspections(req.validated.query);
  sendSuccess(res, { inspections }, { meta });
});
qcRoutes.get('/summary', qcViewers, async (req, res) => sendSuccess(res, await quality.qualitySummary()));
