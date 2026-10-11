import { ORDER_STATUS } from '../constants/orderStatus.js';
import { ROLES } from '../constants/roles.js';
import { DISPATCH_STATUS, Dispatch, FG_STATUS, FinishedGood, deliveryOf } from '../models/Fulfilment.js';
import { ProductionRun } from '../models/ProductionRun.js';
import { Roll } from '../models/Roll.js';
import { findOrderById } from '../repositories/order.repository.js';
import { AppError } from '../utils/AppError.js';
import { dateToDateString } from '../utils/dates.js';
import { cmToMetres } from '../utils/units.js';

/*
 * Phase 11 (buyer portal): a simple timeline of one order (instruction.md §19). It is a view over the
 * order's status history plus progress figures; it exposes no machines, lots, costs or people.
 */

const STAGES = [
  { key: 'CONFIRMED', label: 'Order confirmed', status: ORDER_STATUS.CONFIRMED },
  { key: 'MATERIAL', label: 'Material reserved', status: ORDER_STATUS.MATERIAL_RESERVED },
  { key: 'PRODUCTION', label: 'Production', status: ORDER_STATUS.IN_PRODUCTION },
  { key: 'QC', label: 'Quality check', status: ORDER_STATUS.PRODUCTION_COMPLETED },
  { key: 'READY', label: 'Ready for dispatch', status: ORDER_STATUS.READY_FOR_DISPATCH },
  { key: 'DISPATCHED', label: 'Dispatched', status: ORDER_STATUS.DISPATCHED },
  { key: 'INVOICED', label: 'Invoiced', status: ORDER_STATUS.INVOICED },
];
const ORDERED = STAGES.map((s) => s.status);
const CLOSED = [ORDER_STATUS.CANCELLED, ORDER_STATUS.REJECTED];

/** Extra figures other modules can add (Phase 17 adds the delivery risk). */
const enrichers = [];
export function onTimeline(enricher) {
  enrichers.push(enricher);
}

export async function getTimeline(orderId, actor) {
  const order = await findOrderById(orderId);
  if (!order || (actor.role === ROLES.BUYER && String(order.buyerId) !== actor.buyerId)) throw new AppError('NOT_FOUND', 'Order not found');

  const [runs, rollStats, goods, dispatches] = await Promise.all([
    ProductionRun.find({ orderId: order._id }, { producedCm: 1, status: 1 }).lean(),
    Roll.aggregate([{ $match: { orderId: order._id } }, { $group: { _id: '$status', count: { $sum: 1 }, lengthCm: { $sum: '$lengthCm' } } }]),
    FinishedGood.aggregate([{ $match: { orderId: order._id } }, { $group: { _id: '$status', lengthCm: { $sum: '$lengthCm' } } }]),
    Dispatch.find({ orderId: order._id, status: DISPATCH_STATUS.CONFIRMED }).sort({ confirmedAt: 1 }).lean(),
  ]);
  const producedCm = runs.reduce((sum, r) => sum + r.producedCm, 0);
  const rolls = Object.fromEntries(rollStats.map((r) => [r._id, r]));
  const fg = Object.fromEntries(goods.map((g) => [g._id, g.lengthCm]));
  const passedCm = Object.values(fg).reduce((a, b) => a + b, 0);
  const dispatchedCm = fg[FG_STATUS.DISPATCHED] ?? 0;
  const awaitingQc = (rolls.QC_PENDING?.count ?? 0) + (rolls.IN_REWORK?.count ?? 0);

  const reachedAt = new Map(order.statusHistory.map((h) => [h.to, h.at]));
  const currentIndex = ORDERED.indexOf(order.status);
  const closed = CLOSED.includes(order.status);
  const stages = STAGES.map((stage, index) => {
    let state = 'upcoming';
    if (reachedAt.has(stage.status) && (currentIndex > index || (closed && reachedAt.has(stage.status)))) state = 'done';
    if (index === currentIndex) state = 'current';
    if (currentIndex > index) state = 'done';
    const detail = {
      PRODUCTION: producedCm > 0 ? `${Math.min(100, Math.round((producedCm / order.quantityCm) * 100))}% produced` : null,
      QC: passedCm > 0 ? `${cmToMetres(passedCm)} m passed${awaitingQc ? `, ${awaitingQc} roll${awaitingQc === 1 ? '' : 's'} still being checked` : ''}` : null,
      DISPATCHED: dispatchedCm > 0 ? `${cmToMetres(dispatchedCm)} m dispatched` : null,
    }[stage.key] ?? null;
    return { key: stage.key, label: stage.label, state, at: reachedAt.get(stage.status) ?? null, detail };
  });

  const timeline = {
    orderId: String(order._id),
    orderNumber: order.orderNumber,
    status: order.status,
    closed,
    stages,
    progress: {
      orderedMetres: cmToMetres(order.quantityCm),
      producedMetres: cmToMetres(producedCm),
      producedPercent: Math.min(100, Math.round((producedCm / order.quantityCm) * 100)),
      qcPassedMetres: cmToMetres(passedCm),
      rollsAwaitingQc: awaitingQc,
      dispatchedMetres: cmToMetres(dispatchedCm),
    },
    expectedDelivery: { requiredBy: dateToDateString(order.requiredBy), status: closed ? null : 'ON_TRACK', message: null },
    // Each dispatched consignment and where its delivery stands (dispatched ≠ delivered ≠ verified ≠ invoiced).
    deliveries: dispatches.map((d) => ({ id: String(d._id), dispatchNumber: d.dispatchNumber, metres: cmToMetres(d.totalLengthCm), dispatchedAt: d.confirmedAt, invoiced: Boolean(d.invoiceId), ...deliveryOf(d) })),
  };
  for (const enrich of enrichers) await enrich(timeline, order);
  return timeline;
}
