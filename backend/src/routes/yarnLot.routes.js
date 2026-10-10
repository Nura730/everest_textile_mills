import { Router } from 'express';
import { ROLES } from '../constants/roles.js';
import * as inventoryController from '../controllers/inventory.controller.js';
import { authorize } from '../middleware/authorize.js';
import { requireIdempotencyKey } from '../middleware/idempotencyKey.js';
import { validate } from '../middleware/validate.js';
import {
  ledgerQuerySchema,
  listLotsQuerySchema,
  lotIdParamsSchema,
  receiveLotBodySchema,
} from '../validators/inventory.validators.js';

// Mounted at /api/yarn-lots, after authenticate.
const router = Router();

// The floor sees stock (to know what material exists) but not cost; the service hides cost.
const canViewStock = authorize(ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.ADMIN);

router.get('/', canViewStock, validate({ query: listLotsQuerySchema }), inventoryController.listLots);
router.post(
  '/',
  authorize(ROLES.STORE_KEEPER, ROLES.ADMIN),
  requireIdempotencyKey,
  validate({ body: receiveLotBodySchema }),
  inventoryController.receiveLot,
);
router.get('/:id', canViewStock, validate({ params: lotIdParamsSchema }), inventoryController.getLot);
router.get(
  '/:id/transactions',
  canViewStock,
  validate({ params: lotIdParamsSchema, query: ledgerQuerySchema }),
  inventoryController.getLotTransactions,
);

export default router;
