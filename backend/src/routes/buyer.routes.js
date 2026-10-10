import { Router } from 'express';
import { ROLES } from '../constants/roles.js';
import * as catalogController from '../controllers/catalog.controller.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  createBuyerBodySchema,
  idParamsSchema,
  listBuyersQuerySchema,
  updateBuyerBodySchema,
  updateStatusBodySchema,
} from '../validators/catalog.validators.js';

// Mounted at /api/buyers, after authenticate. Buyer companies are managed by the owner.
const router = Router();
const adminOnly = authorize(ROLES.ADMIN);

router.get('/', adminOnly, validate({ query: listBuyersQuerySchema }), catalogController.listBuyers);
router.post('/', adminOnly, validate({ body: createBuyerBodySchema }), catalogController.createBuyer);
router.get('/:id', adminOnly, validate({ params: idParamsSchema }), catalogController.getBuyer);
router.patch('/:id', adminOnly, validate({ params: idParamsSchema, body: updateBuyerBodySchema }), catalogController.updateBuyer);
router.patch('/:id/status', adminOnly, validate({ params: idParamsSchema, body: updateStatusBodySchema }), catalogController.setBuyerStatus);

export default router;
