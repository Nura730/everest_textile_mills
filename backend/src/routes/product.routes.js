import { Router } from 'express';
import { ALL_ROLES, ROLES } from '../constants/roles.js';
import * as catalogController from '../controllers/catalog.controller.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  createProductBodySchema,
  idParamsSchema,
  listProductsQuerySchema,
  updateProductBodySchema,
  updateStatusBodySchema,
} from '../validators/catalog.validators.js';

// Mounted at /api/products, after authenticate. Everyone browses the catalog (buyers order from
// it; staff plan from it); the service decides which fields and which products each role sees.
const router = Router();
const anyRole = authorize(...ALL_ROLES);

router.get('/', anyRole, validate({ query: listProductsQuerySchema }), catalogController.listProducts);
router.post('/', authorize(ROLES.ADMIN), validate({ body: createProductBodySchema }), catalogController.createProduct);
router.get('/:id', anyRole, validate({ params: idParamsSchema }), catalogController.getProduct);
router.patch('/:id', authorize(ROLES.ADMIN), validate({ params: idParamsSchema, body: updateProductBodySchema }), catalogController.updateProduct);
router.patch('/:id/status', authorize(ROLES.ADMIN), validate({ params: idParamsSchema, body: updateStatusBodySchema }), catalogController.setProductStatus);

export default router;
