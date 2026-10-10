import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { loginAccountLimiter, loginIpLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { loginBodySchema } from '../validators/auth.validators.js';

const router = Router();

// Public: the only way to obtain a token. There is no public registration.
// IP limiter first (counts everything), then validation, then the per-account limiter
// (needs the normalised email from validation).
router.post(
  '/login',
  loginIpLimiter,
  validate({ body: loginBodySchema }),
  loginAccountLimiter,
  authController.login,
);
// Any authenticated role.
router.get('/me', authenticate, authController.me);

export default router;
