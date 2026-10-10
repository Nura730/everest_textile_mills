import { Router } from 'express';
import { attentionFor } from '../services/attention.service.js';
import { z } from 'zod';
import { ALL_ROLES, ROLES } from '../constants/roles.js';
import { DISPATCH_STATUS, FG_STATUS } from '../models/Fulfilment.js';
import { authorize } from '../middleware/authorize.js';
import { requireIdempotencyKey } from '../middleware/idempotencyKey.js';
import { validate } from '../middleware/validate.js';
import * as fulfilment from '../services/fulfilment.service.js';
import { sendIdempotent, sendSuccess } from '../utils/apiResponse.js';
import { requestContext } from '../utils/requestContext.js';
import { objectIdSchema, searchQuerySchema } from '../validators/common.validators.js';
import { signatureInputSchema } from '../validators/quality.validators.js';

// Finished goods (/api/finished-goods), dispatches (/api/dispatches) and invoices (/api/invoices).
//  - stock and dispatch work: STORE_KEEPER and ADMIN (instruction.md §2: the store prepares/confirms dispatch);
//  - viewing finished goods: every internal role; dispatches: internal roles and the owning buyer;
//  - invoices (money): ADMIN issues; ADMIN and the owning buyer read.
const staff = authorize(ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.ADMIN);
const store = authorize(ROLES.STORE_KEEPER, ROLES.ADMIN);
const dispatchViewers = authorize(ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.ADMIN, ROLES.BUYER);
const invoiceViewers = authorize(ROLES.ADMIN, ROLES.BUYER);
const adminOnly = authorize(ROLES.ADMIN);

const page = { page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50) };
const idParams = z.object({ id: objectIdSchema });

export const finishedGoodRoutes = Router();
finishedGoodRoutes.get(
  '/',
  staff,
  validate({ query: z.object({ orderId: objectIdSchema.optional(), status: z.enum(Object.values(FG_STATUS)).optional(), q: searchQuerySchema, ...page }) }),
  async (req, res) => {
    const { finishedGoods, meta } = await fulfilment.listFinishedGoods(req.validated.query);
    sendSuccess(res, { finishedGoods }, { meta });
  },
);
// What can be dispatched per order and why not (one rule for the Ready list and Prepare dispatch).
finishedGoodRoutes.get(
  '/availability',
  staff,
  validate({ query: z.object({ orderId: objectIdSchema.optional() }) }),
  async (req, res) => sendSuccess(res, { orders: await fulfilment.dispatchAvailability(req.validated.query) }),
);
finishedGoodRoutes.patch(
  '/:id/location',
  store,
  requireIdempotencyKey,
  validate({ params: idParams, body: z.strictObject({ location: z.string().trim().min(1).max(60) }) }),
  async (req, res) => sendIdempotent(res, await fulfilment.moveFinishedGood(req.validated.params.id, req.validated.body, requestContext(req))),
);

export const dispatchRoutes = Router();
dispatchRoutes.get(
  '/',
  dispatchViewers,
  validate({ query: z.object({ orderId: objectIdSchema.optional(), status: z.enum(Object.values(DISPATCH_STATUS)).optional(), ...page }) }),
  async (req, res) => {
    const { dispatches, meta } = await fulfilment.listDispatches(req.validated.query, req.user);
    sendSuccess(res, { dispatches }, { meta });
  },
);
dispatchRoutes.post(
  '/',
  store,
  requireIdempotencyKey,
  validate({
    body: z.strictObject({
      orderId: objectIdSchema,
      finishedGoodIds: z.array(objectIdSchema).min(1).max(200),
      vehicleNumber: z.string().trim().min(4).max(20).optional(),
      notes: z.string().trim().min(1).max(500).optional(),
    }),
  }),
  async (req, res) => sendIdempotent(res, await fulfilment.prepareDispatch(req.validated.body, requestContext(req))),
);
dispatchRoutes.get('/:id', dispatchViewers, validate({ params: idParams }), async (req, res) => sendSuccess(res, await fulfilment.getDispatch(req.validated.params.id, req.user)));
dispatchRoutes.post(
  '/:id/confirm',
  store,
  requireIdempotencyKey,
  validate({ params: idParams, body: z.strictObject({ signature: signatureInputSchema.optional(), vehicleNumber: z.string().trim().min(4).max(20).optional() }) }),
  async (req, res) => sendIdempotent(res, await fulfilment.confirmDispatch(req.validated.params.id, req.validated.body, requestContext(req))),
);
dispatchRoutes.post(
  '/:id/cancel',
  store,
  requireIdempotencyKey,
  validate({ params: idParams, body: z.strictObject({ reason: z.string().trim().min(5).max(500) }) }),
  async (req, res) => sendIdempotent(res, await fulfilment.cancelDispatch(req.validated.params.id, req.validated.body, requestContext(req))),
);
dispatchRoutes.post(
  '/:id/invoice',
  adminOnly,
  requireIdempotencyKey,
  validate({ params: idParams, body: z.strictObject({}) }),
  async (req, res) => sendIdempotent(res, await fulfilment.issueInvoice(req.validated.params.id, requestContext(req))),
);

export const invoiceRoutes = Router();
invoiceRoutes.get('/', invoiceViewers, validate({ query: z.object({ orderId: objectIdSchema.optional(), ...page }) }), async (req, res) => {
  const { invoices, meta } = await fulfilment.listInvoices(req.validated.query, req.user);
  sendSuccess(res, { invoices }, { meta });
});
invoiceRoutes.get('/:id', invoiceViewers, validate({ params: idParams }), async (req, res) => sendSuccess(res, await fulfilment.getInvoice(req.validated.params.id, req.user)));

export const summaryRoutes = Router();
summaryRoutes.get('/fulfilment', staff, async (req, res) => sendSuccess(res, await fulfilment.fulfilmentSummary()));
// What needs the caller's attention (navigation badges, dashboard insights); scoped by role and buyer.
summaryRoutes.get('/attention', authorize(...ALL_ROLES), async (req, res) => sendSuccess(res, await attentionFor(req.user)));
