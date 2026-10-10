import { recordAudit } from '../audit/recordAudit.js';
import { ORDER_STATUS } from '../constants/orderStatus.js';
import { ROLL_STATUS } from '../constants/production.js';
import { SIGNATURE_ENTITY, SIGNATURE_STATEMENTS } from '../constants/quality.js';
import { ROLES } from '../constants/roles.js';
import {
  DEFAULT_TAX_RATE_BASIS_POINTS,
  DISPATCH_STATUS,
  Dispatch,
  FG_STATUS,
  FinishedGood,
  Invoice,
  toPublicDispatch,
  toPublicFinishedGood,
  toPublicInvoice,
} from '../models/Fulfilment.js';
import { Order, toPublicOrder } from '../models/Order.js';
import { Roll } from '../models/Roll.js';
import { findBuyerById } from '../repositories/catalog.repository.js';
import { claimLock } from '../repositories/locks.repository.js';
import { findOrderById, nextSequence, transitionStatusGuarded } from '../repositories/order.repository.js';
import { AppError } from '../utils/AppError.js';
import { todayInIndia } from '../utils/dates.js';
import { searchAcross } from '../utils/search.js';
import { cmToMetres } from '../utils/units.js';
import { executeIdempotent } from './idempotency.service.js';
import { onRollInspected, onRollPassed } from './quality.service.js';
import { dispatchRecord, ensureSigningKey, signApproval, toSignatureMeta } from './signing.service.js';

/*
 * Phases 11 and 12: finished goods, dispatch and invoicing.
 *
 *   QC PASS → finished good IN_STOCK (roll FINISHED)
 *   order PRODUCTION_COMPLETED + no roll awaiting QC/rework + stock → READY_FOR_DISPATCH
 *   prepare (STORE)   IN_STOCK → RESERVED_FOR_DISPATCH (guarded per good: no double dispatch)
 *   confirm (STORE, signed)  RESERVED → DISPATCHED; order DISPATCHED when nothing is left in stock
 *   cancel            RESERVED → IN_STOCK
 *   invoice (ADMIN)   one per confirmed dispatch, at the order's own price; order INVOICED when every
 *                     confirmed dispatch of a DISPATCHED order is invoiced
 */

const lockOrder = (id, session) => claimLock(`order:${id}`, session);
const notFound = (what) => new AppError('NOT_FOUND', `${what} not found`);
const year = () => todayInIndia().slice(0, 4);
const number = async (prefix, name, session, pad = 4) => `${prefix}-${year()}-${String(await nextSequence(`${name}:${year()}`, session)).padStart(pad, '0')}`;

function orderChange(order, to, context, reason) {
  return { from: order.status, to, at: new Date(), by: context.actor.id, byRole: context.actor.role, reason };
}

async function moveOrder(order, to, context, session, reason) {
  const updated = await transitionStatusGuarded(order._id, order.status, to, orderChange(order, to, context, reason), session);
  if (!updated) throw new AppError('CONFLICT', 'The order changed meanwhile. Reload and try again.');
  await recordAudit({ action: `ORDER_${to}`, entityType: 'Order', entityId: order._id, orderId: order._id, before: { status: order.status }, after: { status: to, reason } }, context, session);
  return updated;
}

/**
 * Moves a PRODUCTION_COMPLETED order to READY_FOR_DISPATCH once nothing of it is still waiting for QC
 * or rework and at least one finished good is in stock. Safe to call after any roll or run change.
 */
export async function refreshDispatchReadiness(orderId, context, session) {
  await lockOrder(orderId, session);
  const order = await findOrderById(orderId, { session });
  if (!order || order.status !== ORDER_STATUS.PRODUCTION_COMPLETED) return order;
  const waiting = await Roll.countDocuments({ orderId, status: { $in: [ROLL_STATUS.QC_PENDING, ROLL_STATUS.IN_REWORK] } }).session(session);
  const inStock = await FinishedGood.countDocuments({ orderId, status: FG_STATUS.IN_STOCK }).session(session);
  if (waiting > 0 || inStock === 0) return order;
  return moveOrder(order, ORDER_STATUS.READY_FOR_DISPATCH, context, session, 'All rolls inspected; finished goods in stock');
}

// A QC pass turns the roll into a finished good, in the inspection's own transaction.
onRollPassed(async (roll, context, session) => {
  const order = await findOrderById(roll.orderId, { session });
  const [fg] = await FinishedGood.create(
    [
      {
        rollId: roll._id,
        rollNumber: roll.rollNumber,
        orderId: order._id,
        orderNumber: order.orderNumber,
        buyerId: order.buyerId,
        buyerName: order.buyer.name,
        productName: order.product.name,
        material: order.product.material,
        colour: order.product.colour,
        lengthCm: roll.lengthCm,
      },
    ],
    { session },
  );
  await Roll.updateOne({ _id: roll._id, status: ROLL_STATUS.QC_PASSED }, { $set: { status: ROLL_STATUS.FINISHED } }, { session });
  await recordAudit({ action: 'FINISHED_GOOD_CREATED', entityType: 'FinishedGood', entityId: fg._id, orderId: order._id, after: { rollNumber: roll.rollNumber, lengthCm: roll.lengthCm } }, context, session);
  const after = await refreshDispatchReadiness(order._id, context, session);
  return { finishedGood: toPublicFinishedGood(fg.toObject()), orderStatus: after.status };
});

// A rework or reject may have been the last roll holding the order back.
onRollInspected(async (roll, context, session) => {
  const after = await refreshDispatchReadiness(roll.orderId, context, session);
  return { orderStatus: after?.status };
});

// ── Finished goods ──────────────────────────────────────────────────────────────

export async function listFinishedGoods({ orderId, status, q, page, limit }) {
  const filter = { ...searchAcross(['rollNumber', 'orderNumber', 'buyerName', 'productName'], q) };
  if (orderId) filter.orderId = orderId;
  if (status) filter.status = status;
  const [goods, total] = await Promise.all([
    FinishedGood.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    FinishedGood.countDocuments(filter),
  ]);
  return { finishedGoods: goods.map(toPublicFinishedGood), meta: { page, limit, total } };
}

/** Storage location is the only editable field of a finished good (STORE_KEEPER, ADMIN). */
export async function moveFinishedGood(id, { location }, context) {
  return executeIdempotent({ context, operation: 'FG_MOVE', request: { id, location } }, async (session) => {
    const fg = await FinishedGood.findById(id).session(session).lean();
    if (!fg) throw notFound('Finished good');
    if (fg.status === FG_STATUS.DISPATCHED) throw new AppError('CONFLICT', 'A dispatched finished good can no longer be moved');
    const updated = await FinishedGood.findOneAndUpdate({ _id: fg._id, status: { $ne: FG_STATUS.DISPATCHED } }, { $set: { location } }, { returnDocument: 'after', session, lean: true });
    await recordAudit({ action: 'FINISHED_GOOD_MOVED', entityType: 'FinishedGood', entityId: fg._id, orderId: fg.orderId, before: { location: fg.location }, after: { location } }, context, session);
    return { statusCode: 200, body: { finishedGood: toPublicFinishedGood(updated) } };
  });
}

// ── Dispatch ────────────────────────────────────────────────────────────────────

/** Prepare a dispatch of chosen in-stock finished goods of one ready order (STORE_KEEPER, ADMIN). */
export function prepareDispatch({ orderId, finishedGoodIds, vehicleNumber, notes }, context) {
  return executeIdempotent(
    { context, operation: 'DISPATCH_PREPARE', request: { orderId, finishedGoodIds: [...finishedGoodIds].sort(), vehicleNumber, notes } },
    async (session) => {
      await lockOrder(orderId, session);
      const order = await findOrderById(orderId, { session });
      if (!order) throw notFound('Order');
      if (order.status !== ORDER_STATUS.READY_FOR_DISPATCH) {
        throw new AppError('CONFLICT', `Only an order that is ready for dispatch can be dispatched (this one is ${order.status})`, { details: { status: order.status } });
      }
      if (new Set(finishedGoodIds).size !== finishedGoodIds.length) {
        throw new AppError('VALIDATION_ERROR', 'Request validation failed', { details: [{ location: 'body', path: 'finishedGoodIds', message: 'each finished good may appear only once' }] });
      }
      const goods = await FinishedGood.find({ _id: { $in: finishedGoodIds } }).session(session).lean();
      const unavailable = finishedGoodIds.filter((id) => {
        const fg = goods.find((g) => String(g._id) === id);
        return !fg || String(fg.orderId) !== String(order._id) || fg.status !== FG_STATUS.IN_STOCK;
      });
      if (unavailable.length) {
        throw new AppError('FINISHED_GOODS_UNAVAILABLE', 'Some finished goods are not in stock for this order (already reserved, dispatched, or of another order)', {
          details: { finishedGoodIds: unavailable },
        });
      }

      const dispatchNumber = await number('DSP', 'dispatch', session);
      const [dispatch] = await Dispatch.create(
        [
          {
            dispatchNumber,
            orderId: order._id,
            orderNumber: order.orderNumber,
            buyerId: order.buyerId,
            buyerName: order.buyer.name,
            lines: goods.map((g) => ({ finishedGoodId: g._id, rollNumber: g.rollNumber, lengthCm: g.lengthCm })),
            totalLengthCm: goods.reduce((sum, g) => sum + g.lengthCm, 0),
            vehicleNumber: vehicleNumber ?? null,
            notes: notes ?? null,
            preparedBy: context.actor.id,
          },
        ],
        { session },
      );
      // Guarded per good: a good another dispatch took meanwhile makes the count fall short → 409.
      const reserved = await FinishedGood.updateMany(
        { _id: { $in: finishedGoodIds }, status: FG_STATUS.IN_STOCK },
        { $set: { status: FG_STATUS.RESERVED_FOR_DISPATCH, dispatchId: dispatch._id } },
        { session },
      );
      if (reserved.modifiedCount !== finishedGoodIds.length) {
        throw new AppError('FINISHED_GOODS_UNAVAILABLE', 'Some finished goods were taken by another dispatch meanwhile', { details: { finishedGoodIds } });
      }
      await recordAudit(
        { action: 'DISPATCH_PREPARED', entityType: 'Dispatch', entityId: dispatch._id, orderId: order._id, after: { dispatchNumber, rolls: goods.length, totalLengthCm: dispatch.totalLengthCm } },
        context,
        session,
      );
      return { statusCode: 201, body: { dispatch: toPublicDispatch(dispatch.toObject()) } };
    },
  );
}

function loadDispatch(id, session) {
  return Dispatch.findById(id).session(session ?? null).lean();
}

/**
 * Confirm a prepared dispatch: the goods leave the factory. The store keeper accepts the statement and
 * the server signs the dispatch record (rolls, quantity, vehicle) with the store keeper's own RSA key,
 * verifying it before commit; a failed signature leaves the dispatch PREPARED.
 */
export async function confirmDispatch(id, { signature, vehicleNumber }, context) {
  if (signature) await ensureSigningKey(context.actor);
  return executeIdempotent({ context, operation: 'DISPATCH_CONFIRM', request: { id, vehicleNumber, signed: Boolean(signature) } }, async (session) => {
    const preview = await loadDispatch(id, session);
    if (!preview) throw notFound('Dispatch');
    await lockOrder(preview.orderId, session);
    const dispatch = await loadDispatch(id, session);
    if (dispatch.status !== DISPATCH_STATUS.PREPARED) {
      throw new AppError('INVALID_STATE_TRANSITION', `Dispatch ${dispatch.dispatchNumber} is ${dispatch.status}`, {
        details: { from: dispatch.status, to: DISPATCH_STATUS.CONFIRMED, allowedFrom: [DISPATCH_STATUS.PREPARED] },
      });
    }
    if (!signature) {
      throw new AppError('SIGNATURE_REQUIRED', 'Final dispatch must be signed by the store keeper', {
        details: { statement: SIGNATURE_STATEMENTS.DISPATCH(dispatch.dispatchNumber), failedStage: 'PAYLOAD_PREPARED' },
      });
    }
    const { signature: signed, signing } = await signApproval(
      {
        approvalType: 'DISPATCH_CONFIRM',
        entityType: SIGNATURE_ENTITY.DISPATCH,
        entityId: dispatch._id,
        statement: SIGNATURE_STATEMENTS.DISPATCH(dispatch.dispatchNumber),
        // Signed as it will be stored: with the vehicle given now, or the one from preparation.
        record: dispatchRecord({ ...dispatch, vehicleNumber: vehicleNumber ?? dispatch.vehicleNumber ?? null }),
        image: signature.image,
        nonce: `DISPATCH_CONFIRM:${context.idempotencyKey}`,
      },
      context,
      session,
    );
    const moved = await FinishedGood.updateMany(
      { dispatchId: dispatch._id, status: FG_STATUS.RESERVED_FOR_DISPATCH },
      { $set: { status: FG_STATUS.DISPATCHED } },
      { session },
    );
    if (moved.modifiedCount !== dispatch.lines.length) throw new AppError('CONFLICT', 'The dispatch changed meanwhile. Reload and try again.');
    const updated = await Dispatch.findOneAndUpdate(
      { _id: dispatch._id, status: DISPATCH_STATUS.PREPARED },
      { $set: { status: DISPATCH_STATUS.CONFIRMED, confirmedBy: context.actor.id, confirmedAt: new Date(), signatureId: signed._id, ...(vehicleNumber ? { vehicleNumber } : {}) } },
      { returnDocument: 'after', session, lean: true },
    );
    await recordAudit(
      { action: 'DISPATCH_CONFIRMED', entityType: 'Dispatch', entityId: dispatch._id, orderId: dispatch.orderId, before: { status: dispatch.status }, after: { status: DISPATCH_STATUS.CONFIRMED, signed: true, signatureId: String(signed._id), keyId: signing.keyId } },
      context,
      session,
    );

    let order = await findOrderById(dispatch.orderId, { session });
    const left = await FinishedGood.countDocuments({ orderId: order._id, status: { $in: [FG_STATUS.IN_STOCK, FG_STATUS.RESERVED_FOR_DISPATCH] } }).session(session);
    if (left === 0 && order.status === ORDER_STATUS.READY_FOR_DISPATCH) {
      order = await moveOrder(order, ORDER_STATUS.DISPATCHED, context, session, `Dispatch ${dispatch.dispatchNumber} confirmed`);
    }
    return { statusCode: 200, body: { dispatch: toPublicDispatch(updated), orderStatus: order.status, signature: { ...toSignatureMeta(signed), verified: true, stages: signing.stages } } };
  });
}

export function cancelDispatch(id, { reason }, context) {
  return executeIdempotent({ context, operation: 'DISPATCH_CANCEL', request: { id, reason } }, async (session) => {
    const preview = await loadDispatch(id, session);
    if (!preview) throw notFound('Dispatch');
    await lockOrder(preview.orderId, session);
    const dispatch = await loadDispatch(id, session);
    if (dispatch.status !== DISPATCH_STATUS.PREPARED) {
      throw new AppError('INVALID_STATE_TRANSITION', `Dispatch ${dispatch.dispatchNumber} is ${dispatch.status}; a confirmed dispatch cannot be cancelled`, {
        details: { from: dispatch.status, to: DISPATCH_STATUS.CANCELLED, allowedFrom: [DISPATCH_STATUS.PREPARED] },
      });
    }
    await FinishedGood.updateMany({ dispatchId: dispatch._id, status: FG_STATUS.RESERVED_FOR_DISPATCH }, { $set: { status: FG_STATUS.IN_STOCK, dispatchId: null } }, { session });
    const updated = await Dispatch.findOneAndUpdate(
      { _id: dispatch._id, status: DISPATCH_STATUS.PREPARED },
      { $set: { status: DISPATCH_STATUS.CANCELLED, cancelledReason: reason } },
      { returnDocument: 'after', session, lean: true },
    );
    await recordAudit({ action: 'DISPATCH_CANCELLED', entityType: 'Dispatch', entityId: dispatch._id, orderId: dispatch.orderId, before: { status: dispatch.status }, after: { status: DISPATCH_STATUS.CANCELLED, reason } }, context, session);
    return { statusCode: 200, body: { dispatch: toPublicDispatch(updated) } };
  });
}

/** Buyers see only their own company's dispatches and invoices (404 otherwise, like orders). */
function buyerScope(actor) {
  if (actor.role !== ROLES.BUYER) return {};
  return { buyerId: actor.buyerId ?? '000000000000000000000000' };
}

export async function listDispatches({ orderId, status, page, limit }, actor) {
  const filter = { ...buyerScope(actor) };
  if (orderId) filter.orderId = orderId;
  if (status) filter.status = status;
  const [dispatches, total] = await Promise.all([
    Dispatch.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Dispatch.countDocuments(filter),
  ]);
  return { dispatches: dispatches.map(toPublicDispatch), meta: { page, limit, total } };
}

export async function getDispatch(id, actor) {
  const dispatch = await Dispatch.findOne({ _id: id, ...buyerScope(actor) }).lean();
  if (!dispatch) throw notFound('Dispatch');
  return { dispatch: toPublicDispatch(dispatch) };
}

// ── Invoices ────────────────────────────────────────────────────────────────────

/** Issue the invoice of a confirmed dispatch (ADMIN). One per dispatch; never edited afterwards. */
export function issueInvoice(dispatchId, context) {
  return executeIdempotent({ context, operation: 'INVOICE_ISSUE', request: { dispatchId } }, async (session) => {
    const preview = await loadDispatch(dispatchId, session);
    if (!preview) throw notFound('Dispatch');
    await lockOrder(preview.orderId, session);
    const dispatch = await loadDispatch(dispatchId, session);
    if (dispatch.status !== DISPATCH_STATUS.CONFIRMED) throw new AppError('CONFLICT', `Only a confirmed dispatch can be invoiced (this one is ${dispatch.status})`);
    if (dispatch.invoiceId) throw new AppError('DUPLICATE_RESOURCE', `Dispatch ${dispatch.dispatchNumber} is already invoiced`, { details: { fields: ['dispatchId'] } });
    const order = await findOrderById(dispatch.orderId, { session });
    const buyer = await findBuyerById(order.buyerId, { session });
    const price = order.product.pricePerMetrePaise;
    const lines = dispatch.lines.map((l) => ({
      description: `${order.product.name} — roll ${l.rollNumber}`,
      lengthCm: l.lengthCm,
      pricePerMetrePaise: price,
      amountPaise: Math.round((l.lengthCm * price) / 100),
    }));
    const subtotalPaise = lines.reduce((sum, l) => sum + l.amountPaise, 0);
    const taxPaise = Math.round((subtotalPaise * DEFAULT_TAX_RATE_BASIS_POINTS) / 10_000);
    const invoiceNumber = await number('INV', 'invoice', session);
    const [invoice] = await Invoice.create(
      [
        {
          invoiceNumber,
          orderId: order._id,
          orderNumber: order.orderNumber,
          dispatchId: dispatch._id,
          dispatchNumber: dispatch.dispatchNumber,
          buyerId: order.buyerId,
          buyer: { code: order.buyer.code, name: order.buyer.name, address: buyer?.address ?? null },
          lines,
          subtotalPaise,
          taxRateBasisPoints: DEFAULT_TAX_RATE_BASIS_POINTS,
          taxPaise,
          totalPaise: subtotalPaise + taxPaise,
          issuedBy: context.actor.id,
        },
      ],
      { session },
    );
    await Dispatch.updateOne({ _id: dispatch._id, invoiceId: null }, { $set: { invoiceId: invoice._id } }, { session });
    await recordAudit({ action: 'INVOICE_ISSUED', entityType: 'Invoice', entityId: invoice._id, orderId: order._id, after: { invoiceNumber, dispatchNumber: dispatch.dispatchNumber, totalPaise: invoice.totalPaise } }, context, session);

    let after = order;
    if (order.status === ORDER_STATUS.DISPATCHED) {
      const uninvoiced = await Dispatch.countDocuments({ orderId: order._id, status: DISPATCH_STATUS.CONFIRMED, invoiceId: null }).session(session);
      if (uninvoiced === 0) after = await moveOrder(order, ORDER_STATUS.INVOICED, context, session, `Invoice ${invoiceNumber} issued`);
    }
    return { statusCode: 201, body: { invoice: toPublicInvoice(invoice.toObject()), order: toPublicOrder(after, context.actor) } };
  });
}

export async function listInvoices({ orderId, page, limit }, actor) {
  const filter = { ...buyerScope(actor) };
  if (orderId) filter.orderId = orderId;
  const [invoices, total] = await Promise.all([
    Invoice.find(filter).sort({ issuedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Invoice.countDocuments(filter),
  ]);
  return { invoices: invoices.map(toPublicInvoice), meta: { page, limit, total } };
}

export async function getInvoice(id, actor) {
  const invoice = await Invoice.findOne({ _id: id, ...buyerScope(actor) }).lean();
  if (!invoice) throw notFound('Invoice');
  return { invoice: toPublicInvoice(invoice) };
}

/** Dispatch summary for dashboards. */
/**
 * What can be dispatched for each order, and if nothing, exactly why. ONE rule for the Ready-orders list
 * and the Prepare-dispatch window (they used to disagree: an order stays READY_FOR_DISPATCH while its
 * goods sit in a prepared, not yet confirmed dispatch, so the list offered "Prepare" with nothing left).
 *   dispatchable = finished goods IN_STOCK (QC passed, not reserved, not dispatched)
 *   reserved     = goods in PREPARED dispatches awaiting signed confirmation (named)
 *   awaitingQc   = rolls QC_PENDING or IN_REWORK (never dispatchable until they pass)
 *   rejected     = rejected rolls (never dispatchable)
 * Without `orderId`: every READY_FOR_DISPATCH order.
 */
export async function dispatchAvailability({ orderId } = {}) {
  const orders = await Order.find(orderId ? { _id: orderId } : { status: ORDER_STATUS.READY_FOR_DISPATCH }).sort({ requiredBy: 1 }).limit(200).lean();
  if (orderId && orders.length === 0) throw notFound('Order');
  const ids = orders.map((o) => o._id);
  const [goods, rolls, prepared] = await Promise.all([
    FinishedGood.aggregate([{ $match: { orderId: { $in: ids } } }, { $group: { _id: { orderId: '$orderId', status: '$status' }, rolls: { $sum: 1 }, cm: { $sum: '$lengthCm' } } }]),
    Roll.aggregate([
      { $match: { orderId: { $in: ids }, status: { $in: [ROLL_STATUS.QC_PENDING, ROLL_STATUS.IN_REWORK, ROLL_STATUS.REJECTED] } } },
      { $group: { _id: { orderId: '$orderId', status: '$status' }, rolls: { $sum: 1 }, cm: { $sum: '$lengthCm' } } },
    ]),
    Dispatch.find({ orderId: { $in: ids }, status: DISPATCH_STATUS.PREPARED }, { dispatchNumber: 1, orderId: 1, totalLengthCm: 1 }).lean(),
  ]);
  const pick = (rows, id, status) => rows.find((r) => String(r._id.orderId) === String(id) && r._id.status === status) ?? { rolls: 0, cm: 0 };
  const sum = (rows, id, statuses) => statuses.map((s) => pick(rows, id, s)).reduce((a, b) => ({ rolls: a.rolls + b.rolls, cm: a.cm + b.cm }), { rolls: 0, cm: 0 });
  const m = (cm) => `${cmToMetres(cm).toLocaleString('en-IN')} m`;

  return orders.map((order) => {
    const inStock = pick(goods, order._id, FG_STATUS.IN_STOCK);
    const reserved = pick(goods, order._id, FG_STATUS.RESERVED_FOR_DISPATCH);
    const dispatched = pick(goods, order._id, FG_STATUS.DISPATCHED);
    const awaitingQc = sum(rolls, order._id, [ROLL_STATUS.QC_PENDING, ROLL_STATUS.IN_REWORK]);
    const rejected = pick(rolls, order._id, ROLL_STATUS.REJECTED);
    const dispatches = prepared.filter((d) => String(d.orderId) === String(order._id)).map((d) => ({ id: String(d._id), dispatchNumber: d.dispatchNumber, metres: cmToMetres(d.totalLengthCm) }));
    let reason = null;
    let message = null;
    if (inStock.cm === 0) {
      if (order.status !== ORDER_STATUS.READY_FOR_DISPATCH && order.status !== ORDER_STATUS.DISPATCHED) {
        reason = 'NOT_READY';
        message = awaitingQc.rolls
          ? `${awaitingQc.rolls} roll(s) (${m(awaitingQc.cm)}) are still awaiting quality inspection; nothing can be dispatched until they pass.`
          : `The order is ${order.status}; it becomes dispatchable once production is complete and its rolls have passed QC.`;
      } else if (reserved.cm > 0) {
        reason = 'RESERVED_IN_PREPARED_DISPATCH';
        message = `All finished goods (${m(reserved.cm)}) are already in ${dispatches.map((d) => d.dispatchNumber).join(', ')}, waiting for the signed confirmation. Confirm or cancel that dispatch in the Dispatches tab.`;
      } else if (dispatched.cm > 0) {
        reason = 'ALL_DISPATCHED';
        message = `Everything produced has been dispatched (${m(dispatched.cm)}).`;
      } else {
        reason = 'NO_STOCK';
        message = rejected.rolls ? `No finished goods: ${rejected.rolls} roll(s) (${m(rejected.cm)}) were rejected in QC.` : 'No finished goods have been recorded for this order.';
      }
    }
    return {
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      status: order.status,
      orderedMetres: cmToMetres(order.quantityCm),
      inStock: { rolls: inStock.rolls, metres: cmToMetres(inStock.cm) },
      reserved: { rolls: reserved.rolls, metres: cmToMetres(reserved.cm), dispatches },
      dispatched: { rolls: dispatched.rolls, metres: cmToMetres(dispatched.cm) },
      awaitingQc: { rolls: awaitingQc.rolls, metres: cmToMetres(awaitingQc.cm) },
      rejected: { rolls: rejected.rolls, metres: cmToMetres(rejected.cm) },
      dispatchableMetres: cmToMetres(inStock.cm),
      reason,
      message,
    };
  });
}

export async function fulfilmentSummary() {
  const [goods, dispatches] = await Promise.all([
    FinishedGood.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, lengthCm: { $sum: '$lengthCm' } } }]),
    Dispatch.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);
  return {
    finishedGoods: Object.fromEntries(goods.map((g) => [g._id, { rolls: g.count, metres: cmToMetres(g.lengthCm) }])),
    dispatches: Object.fromEntries(dispatches.map((d) => [d._id, d.count])),
  };
}
