import { Router } from 'express';
import { z } from 'zod';
import { ROLES } from '../constants/roles.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { Invoice } from '../models/Fulfilment.js';
import { Machine } from '../models/Machine.js';
import { Order } from '../models/Order.js';
import { YarnLot } from '../models/YarnLot.js';
import * as costing from '../services/costing.service.js';
import { fulfilmentSummary } from '../services/fulfilment.service.js';
import { qualitySummary } from '../services/quality.service.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { requestContext } from '../utils/requestContext.js';
import { gramsToKg } from '../utils/units.js';
import { objectIdSchema } from '../validators/common.validators.js';

// Mounted at /api/costing. Cost and profit are owner-only information (instruction.md §16).
const router = Router();
const adminOnly = authorize(ROLES.ADMIN);
const paise = z.number().int().min(0).max(100_000_000);

router.get('/summary', adminOnly, async (req, res) => sendSuccess(res, await costing.costingSummary()));
router.get('/orders/:id', adminOnly, validate({ params: z.object({ id: objectIdSchema }) }), async (req, res) => sendSuccess(res, await costing.orderCost(req.validated.params.id)));
router.get('/rates', adminOnly, async (req, res) => sendSuccess(res, await costing.getRates()));
router.post(
  '/rates',
  adminOnly,
  validate({
    body: z.strictObject({
      labourPaisePerHour: paise,
      machinePaisePerHour: z.strictObject({ SPINNING: paise, WEAVING: paise, DYEING: paise, FINISHING: paise }),
      reworkPaisePerRoll: paise,
      overheadBasisPoints: z.number().int().min(0).max(10_000),
      workingHoursPerDay: z.number().int().min(1).max(24),
      note: z.string().trim().min(1).max(500).optional(),
    }),
  }),
  async (req, res) => sendSuccess(res, { rateCard: await costing.saveRates(req.validated.body, requestContext(req)) }, { status: 201 }),
);

/** The owner's factory overview (instruction.md Phase 10): orders, machines, stock, QC, dispatch, revenue. */
router.get('/overview', adminOnly, async (req, res) => {
  const [orders, machines, stock, quality, fulfilment, revenue] = await Promise.all([
    Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Machine.aggregate([{ $match: { isActive: true } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    YarnLot.aggregate([{ $group: { _id: null, totalGrams: { $sum: '$totalGrams' }, reservedGrams: { $sum: '$reservedGrams' } } }]),
    qualitySummary(),
    fulfilmentSummary(),
    Invoice.aggregate([{ $group: { _id: null, subtotalPaise: { $sum: '$subtotalPaise' }, count: { $sum: 1 } } }]),
  ]);
  sendSuccess(res, {
    orders: Object.fromEntries(orders.map((o) => [o._id, o.count])),
    machines: Object.fromEntries(machines.map((m) => [m._id, m.count])),
    stock: { totalKg: gramsToKg(stock[0]?.totalGrams ?? 0), reservedKg: gramsToKg(stock[0]?.reservedGrams ?? 0), availableKg: gramsToKg((stock[0]?.totalGrams ?? 0) - (stock[0]?.reservedGrams ?? 0)) },
    quality,
    fulfilment,
    revenue: { invoicedPaise: revenue[0]?.subtotalPaise ?? 0, invoices: revenue[0]?.count ?? 0 },
  });
});

export default router;
