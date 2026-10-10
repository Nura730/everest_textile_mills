import { Router } from 'express';
import { ROLES } from '../constants/roles.js';
import * as inventoryController from '../controllers/inventory.controller.js';
import { authorize } from '../middleware/authorize.js';
import { requireIdempotencyKey } from '../middleware/idempotencyKey.js';
import { validate } from '../middleware/validate.js';
import { receiveLotBodySchema } from '../validators/inventory.validators.js';

// Mounted at /api/yarn-lots, after authenticate.
const router = Router();

router.post(
  '/',
  authorize(ROLES.STORE_KEEPER, ROLES.ADMIN),
  requireIdempotencyKey,
  validate({ body: receiveLotBodySchema }),
  inventoryController.receiveLot,
);

export default router;
