import { Router } from "express";
import { z } from "zod";
import { ALL_ROLES, ROLES } from "../constants/roles.js";
import * as orderController from "../controllers/order.controller.js";
import { getTimeline } from "../services/portal.service.js";
import { reserveAdditional } from "../services/material.service.js";
import { requestContext } from "../utils/requestContext.js";
import { sendIdempotent, sendSuccess } from "../utils/apiResponse.js";
import { authorize } from "../middleware/authorize.js";
import { requireIdempotencyKey } from "../middleware/idempotencyKey.js";
import { validate } from "../middleware/validate.js";
import {
  adminCreateOrderBodySchema,
  buyerCreateOrderBodySchema,
  confirmOrderBodySchema,
  issueOrderBodySchema,
  reserveOrderBodySchema,
  returnOrderBodySchema,
  updateOrderBodySchema,
  listOrdersQuerySchema,
  orderIdParamsSchema,
  statusChangeBodySchema,
} from "../validators/order.validators.js";

// Mounted at /api/orders, after authenticate. Ownership (a buyer sees only their own orders) is
// enforced in the order service, on every read and every status change.
const router = Router();
// Who may see a feasibility check or an order's reservations: they expose stock levels, so
// internal planning roles only. Moving yarn (reserve, issue, return) is the store's job.
const FEASIBILITY_VIEWERS = [ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.ADMIN];
const STORE = [ROLES.STORE_KEEPER, ROLES.ADMIN];
// Reserving yarn for production is a floor decision; issuing and returning physical yarn is the store's.
const RESERVERS = [ROLES.FLOOR_MANAGER, ROLES.ADMIN];

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
router.patch(
  "/:id",
  authorize(ROLES.BUYER, ROLES.ADMIN),
  requireIdempotencyKey,
  validate({ params: orderIdParamsSchema, body: updateOrderBodySchema }),
  orderController.updateOrder,
);
router.get(
  "/:id/timeline",
  authorize(...ALL_ROLES),
  validate({ params: orderIdParamsSchema }),
  async (req, res) => sendSuccess(res, { timeline: await getTimeline(req.validated.params.id, req.user) }),
);
router.get(
  "/:id/feasibility",
  authorize(...FEASIBILITY_VIEWERS),
  validate({ params: orderIdParamsSchema }),
  orderController.getOrderFeasibility,
);
router.post(
  "/:id/confirm",
  authorize(ROLES.ADMIN),
  requireIdempotencyKey,
  validate({ params: orderIdParamsSchema, body: confirmOrderBodySchema }),
  orderController.confirmOrder,
);
router.post(
  "/:id/reserve",
  authorize(...RESERVERS),
  requireIdempotencyKey,
  validate({ params: orderIdParamsSchema, body: reserveOrderBodySchema }),
  orderController.reserveMaterial,
);
// More yarn for a continuation run or remakes (floor manager / admin; reason required; free stock only).
router.post(
  "/:id/reserve-additional",
  authorize(...RESERVERS),
  requireIdempotencyKey,
  validate({ params: orderIdParamsSchema, body: z.strictObject({ quantityKg: z.number().positive().max(100_000).refine((v) => Math.round(v * 1000) === v * 1000, { error: "must have at most 3 decimal places" }), reason: z.string().trim().min(5).max(500) }) }),
  async (req, res) => sendIdempotent(res, await reserveAdditional(req.validated.params.id, req.validated.body, requestContext(req))),
);
router.get(
  "/:id/reservations",
  authorize(...FEASIBILITY_VIEWERS),
  validate({ params: orderIdParamsSchema }),
  orderController.getReservations,
);
router.post(
  "/:id/issue",
  authorize(...STORE),
  requireIdempotencyKey,
  validate({ params: orderIdParamsSchema, body: issueOrderBodySchema }),
  orderController.issueMaterial,
);
router.post(
  "/:id/return",
  authorize(...STORE),
  requireIdempotencyKey,
  validate({ params: orderIdParamsSchema, body: returnOrderBodySchema }),
  orderController.returnMaterial,
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
