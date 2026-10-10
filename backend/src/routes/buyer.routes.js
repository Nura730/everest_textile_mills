import { Router } from 'express';
import { ROLES } from '../constants/roles.js';
import * as catalogController from '../controllers/catalog.controller.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { createBuyerBodySchema, idParamsSchema, listBuyersQuerySchema } from '../validators/catalog.validators.js';

// Mounted at /api/buyers, after authenticate. Buyer companies are managed by the owner.
const router = Router();
const adminOnly = authorize(ROLES.ADMIN);

router.get('/', adminOnly, validate({ query: listBuyersQuerySchema }), catalogController.listBuyers);
router.post('/', adminOnly, validate({ body: createBuyerBodySchema }), catalogController.createBuyer);
router.get('/:id', adminOnly, validate({ params: idParamsSchema }), catalogController.getBuyer);

export default router;
