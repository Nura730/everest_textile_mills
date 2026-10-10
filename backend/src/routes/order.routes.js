import { Router } from "express";
import { ALL_ROLES, ROLES } from "../constants/roles.js";
import * as orderController from "../controllers/order.controller.js";
import { authorize } from "../middleware/authorize.js";
import { requireIdempotencyKey } from "../middleware/idempotencyKey.js";
import { validate } from "../middleware/validate.js";
import {
  adminCreateOrderBodySchema,
  buyerCreateOrderBodySchema,
  listOrdersQuerySchema,
  orderIdParamsSchema,
  statusChangeBodySchema,
} from "../validators/order.validators.js";

// Mounted at /api/orders, after authenticate. Ownership (a buyer sees only their own orders) is
// enforced in the order service, on every read and every status change.
const router = Router();

/** The body a caller may send depends on who they are: only an ADMIN may name the buyer. */
function validateCreateOrderBody(req, res, next) {
  const body =
    req.user.role === ROLES.ADMIN
      ? adminCreateOrderBodySchema
      : buyerCreateOrderBodySchema;
  return validate({ body })(req, res, next);
}

router.get(
  "/",
  authorize(...ALL_ROLES),
  validate({ query: listOrdersQuerySchema }),
  orderController.listOrders,
);
router.post(
  "/",
  authorize(ROLES.BUYER, ROLES.ADMIN),
  requireIdempotencyKey,
  validateCreateOrderBody,
  orderController.createOrder,
);
router.get(
  "/:id",
  authorize(...ALL_ROLES),
  validate({ params: orderIdParamsSchema }),
  orderController.getOrder,
);
router.post(
  "/:id/cancel",
  authorize(ROLES.BUYER, ROLES.ADMIN),
  requireIdempotencyKey,
  validate({ params: orderIdParamsSchema, body: statusChangeBodySchema }),
  orderController.cancelOrder,
);
router.post(
  "/:id/reject",
  authorize(ROLES.ADMIN),
  requireIdempotencyKey,
  validate({ params: orderIdParamsSchema, body: statusChangeBodySchema }),
  orderController.rejectOrder,
);

export default router;
