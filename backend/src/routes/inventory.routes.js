import { Router } from 'express';
import { ROLES } from '../constants/roles.js';
import * as inventoryController from '../controllers/inventory.controller.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { yarnSummaryQuerySchema } from '../validators/inventory.validators.js';

// Mounted at /api/inventory, after authenticate. Cross-lot views of stock.
const router = Router();

router.get(
  '/yarn-summary',
  authorize(ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.ADMIN),
  validate({ query: yarnSummaryQuerySchema }),
  inventoryController.getYarnSummary,
);
// Proves stored balances against the ledger. Owner-level oversight.
router.get('/reconciliation', authorize(ROLES.ADMIN), inventoryController.getReconciliation);

export default router;
