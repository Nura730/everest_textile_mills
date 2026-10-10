import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { loginBodySchema } from '../validators/auth.validators.js';

const router = Router();

// Public: the only way to obtain a token. There is no public registration.
router.post('/login', validate({ body: loginBodySchema }), authController.login);
// Any authenticated role.
router.get('/me', authenticate, authController.me);

export default router;
