import { Router } from 'express';
import { z } from 'zod';
import { ALL_ROLES, ROLES } from '../constants/roles.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { User } from '../models/User.js';
import { rotateSigningKey, signingKeyOf, verifySignature } from '../services/signing.service.js';
import { AppError } from '../utils/AppError.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { requestContext } from '../utils/requestContext.js';
import { objectIdSchema } from '../validators/common.validators.js';

// Mounted at /api/signatures. Verification of signed approvals and public signing-key information.
// Private keys never leave the server and no route returns them.
const router = Router();
const staff = authorize(ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.ADMIN);
const byId = { params: z.object({ id: objectIdSchema }) };

router.get('/keys/me', authorize(...ALL_ROLES), async (req, res) => sendSuccess(res, { key: await signingKeyOf(req.user.id) }));
router.get('/keys/:id', authorize(ROLES.ADMIN), validate(byId), async (req, res) => sendSuccess(res, { key: await signingKeyOf(req.validated.params.id) }));
// Retire a user's key (e.g. suspected compromise) and issue a new one; old signatures stay verifiable.
router.post('/keys/:id/rotate', authorize(ROLES.ADMIN), validate(byId), async (req, res) => {
  const user = await User.findById(req.validated.params.id, { _id: 1 }).lean();
  if (!user) throw new AppError('NOT_FOUND', 'User not found');
  sendSuccess(res, { key: await rotateSigningKey(user._id, requestContext(req)) }, { status: 201 });
});
router.get('/:id/verify', staff, validate(byId), async (req, res) => sendSuccess(res, { verification: await verifySignature(req.validated.params.id, requestContext(req)) }));

export default router;
