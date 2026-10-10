import { Router } from 'express';
import { ROLES } from '../constants/roles.js';
import * as userController from '../controllers/user.controller.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import {
  createUserBodySchema,
  listUsersQuerySchema,
  updateUserStatusBodySchema,
  userIdParamsSchema,
} from '../validators/user.validators.js';

// Mounted after authenticate. authorize runs BEFORE validate: a non-admin gets 403
// without learning the shape of the admin form from validation errors.
const router = Router();
const adminOnly = authorize(ROLES.ADMIN);

router.get('/', adminOnly, validate({ query: listUsersQuerySchema }), userController.list);
router.post('/', adminOnly, validate({ body: createUserBodySchema }), userController.create);
router.patch(
  '/:id/status',
  adminOnly,
  validate({ params: userIdParamsSchema, body: updateUserStatusBodySchema }),
  userController.updateStatus,
);

export default router;
