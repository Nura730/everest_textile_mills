import { Router } from 'express';
import { ROLES } from '../constants/roles.js';
import * as userController from '../controllers/user.controller.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { createUserBodySchema } from '../validators/user.validators.js';

// Mounted after authenticate. authorize runs BEFORE validate: a non-admin gets 403
// without learning the shape of the admin form from validation errors.
const router = Router();

router.post('/', authorize(ROLES.ADMIN), validate({ body: createUserBodySchema }), userController.create);

export default router;
