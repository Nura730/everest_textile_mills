import { Router } from 'express';
import { ROLES } from '../constants/roles.js';
import * as machineController from '../controllers/machine.controller.js';
import { authorize } from '../middleware/authorize.js';
import { requireIdempotencyKey } from '../middleware/idempotencyKey.js';
import { validate } from '../middleware/validate.js';
import { correctMaintenanceCost } from '../services/machine.service.js';
import { sendIdempotent } from '../utils/apiResponse.js';
import { requestContext } from '../utils/requestContext.js';
import {
  createMachineBodySchema,
  listMachinesQuerySchema,
  machineActiveBodySchema,
  machineEventsQuerySchema,
  machineIdParamsSchema,
  endMaintenanceBodySchema,
  maintenanceCostCorrectionBodySchema,
  maintenanceEventParamsSchema,
  maintenanceBodySchema,
  problemParamsSchema,
  reportProblemBodySchema,
  resolveProblemBodySchema,
  updateMachineBodySchema,
} from '../validators/machine.validators.js';

// Mounted at /api/machines, after authenticate.
//  - viewing: the floor (FLOOR_MANAGER), QC (rolls come from machines) and the owner;
//  - registering and editing machines: ADMIN;
//  - maintenance and problems: FLOOR_MANAGER and ADMIN (instruction.md §8: the floor manager reports problems).
const router = Router();
const viewers = authorize(ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.ADMIN);
const operators = authorize(ROLES.FLOOR_MANAGER, ROLES.ADMIN);
const adminOnly = authorize(ROLES.ADMIN);
const byId = { params: machineIdParamsSchema };

router.get('/', viewers, validate({ query: listMachinesQuerySchema }), machineController.listMachines);
router.post('/', adminOnly, validate({ body: createMachineBodySchema }), machineController.createMachine);
router.get('/:id', viewers, validate(byId), machineController.getMachine);
router.patch('/:id', adminOnly, validate({ ...byId, body: updateMachineBodySchema }), machineController.updateMachine);
router.patch('/:id/active', adminOnly, validate({ ...byId, body: machineActiveBodySchema }), machineController.setMachineActive);
router.get('/:id/events', viewers, validate({ ...byId, query: machineEventsQuerySchema }), machineController.getMachineEvents);
router.post('/:id/maintenance/start', operators, requireIdempotencyKey, validate({ ...byId, body: maintenanceBodySchema }), machineController.startMaintenance);
router.post('/:id/maintenance/end', operators, requireIdempotencyKey, validate({ ...byId, body: endMaintenanceBodySchema }), machineController.endMaintenance);
// Correct a finished maintenance's cost (ADMIN; reason required; a new record, the original stays).
router.post(
  '/:id/maintenance/:eventId/cost-correction',
  authorize(ROLES.ADMIN),
  requireIdempotencyKey,
  validate({ params: maintenanceEventParamsSchema, body: maintenanceCostCorrectionBodySchema }),
  async (req, res) => sendIdempotent(res, await correctMaintenanceCost(req.validated.params.id, req.validated.params.eventId, req.validated.body, requestContext(req))),
);
router.post('/:id/problems', operators, requireIdempotencyKey, validate({ ...byId, body: reportProblemBodySchema }), machineController.reportProblem);
router.post(
  '/:id/problems/:eventId/resolve',
  operators,
  requireIdempotencyKey,
  validate({ params: problemParamsSchema, body: resolveProblemBodySchema }),
  machineController.resolveProblem,
);

export default router;
