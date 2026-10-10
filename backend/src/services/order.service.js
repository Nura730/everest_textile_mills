import { recordAudit } from '../audit/recordAudit.js';
import { ORDER_STATUS, allowedNextStatuses, canTransition } from '../constants/orderStatus.js';
import { ROLES } from '../constants/roles.js';
import { toPublicOrder } from '../models/Order.js';
import { findBuyerById, findProductById } from '../repositories/catalog.repository.js';
import {
  findOrderById,
  findOrdersPage,
  insertOrder,
  nextSequence,
  transitionStatusGuarded,
} from '../repositories/order.repository.js';
import { AppError } from '../utils/AppError.js';
import { dateStringToDate, todayInIndia } from '../utils/dates.js';
import { metresToCm } from '../utils/units.js';
import { executeIdempotent } from './idempotency.service.js';

/**
 * Integer-only order maths.
 * Yarn is rounded UP: under-planning yarn stops production, over-planning by a gram costs nothing.
 * Value is rounded to the nearest paisa.
 */
export function calculateOrderFigures(quantityCm, { yarnGramsPerMetre, pricePerMetrePaise }) {
  return {
    requiredYarnGrams: Math.ceil((quantityCm * yarnGramsPerMetre) / 100),
    orderValuePaise: Math.round((quantityCm * pricePerMetrePaise) / 100),
  };
}

export function formatOrderNumber(year, seq) {
  return `ORD-${year}-${String(seq).padStart(4, '0')}`;
}

function notFound() {
  return new AppError('NOT_FOUND', 'Order not found');
}

function missingReference(field) {
  return new AppError('VALIDATION_ERROR', 'Request validation failed', {
    details: [{ location: 'body', path: field, message: 'does not exist' }],
  });
}

/** Ownership: a BUYER may only touch their own company's orders. */
function isOwnedBy(order, actor) {
  return actor.role !== ROLES.BUYER || (actor.buyerId !== null && String(order.buyerId) === actor.buyerId);
}

/**
 * Which buyer company an order is for. A BUYER always orders for their own company (the body
 * schema for buyers cannot even contain buyerId); an ADMIN names the company.
 */
function resolveBuyerId(input, actor) {
  if (actor.role === ROLES.BUYER) {
    if (!actor.buyerId) {
      throw new AppError('FORBIDDEN', 'Your account is not linked to a buyer company');
    }
    return actor.buyerId;
  }
  return input.buyerId;
}

export function createOrder(input, context) {
  const { actor } = context;
  const buyerId = resolveBuyerId(input, actor);

  return executeIdempotent({ context, operation: 'ORDER_CREATE', request: input }, async (session) => {
    const buyer = await findBuyerById(buyerId, { session });
    if (!buyer) {
      // For a BUYER this means their linked company vanished: treat the account as unlinked.
      if (actor.role === ROLES.BUYER) throw new AppError('FORBIDDEN', 'Your account is not linked to a buyer company');
      throw missingReference('buyerId');
    }
    if (!buyer.isActive) throw new AppError('BUYER_INACTIVE', 'This buyer company is inactive and cannot place orders');

    const product = await findProductById(input.productId, { session });
    if (!product) throw missingReference('productId');
    if (!product.isActive) throw new AppError('PRODUCT_INACTIVE', 'This product is no longer available');

    const quantityCm = metresToCm(input.quantityMetres);
    const pricePerMetrePaise = product.defaultPricePerMetrePaise;
    const { requiredYarnGrams, orderValuePaise } = calculateOrderFigures(quantityCm, {
      yarnGramsPerMetre: product.yarnGramsPerMetre,
      pricePerMetrePaise,
    });

    // Numbered inside the transaction: a failed creation does not consume a number.
    const year = todayInIndia().slice(0, 4);
    const orderNumber = formatOrderNumber(year, await nextSequence(`order:${year}`, session));
    const now = new Date();

    const order = await insertOrder(
      {
        orderNumber,
        buyerId: buyer._id,
        buyer: { code: buyer.code, name: buyer.name },
        productId: product._id,
        product: {
          code: product.code,
          name: product.name,
          material: product.material,
          colour: product.colour,
          yarnGramsPerMetre: product.yarnGramsPerMetre,
          pricePerMetrePaise,
        },
        quantityCm,
        requiredYarnGrams,
        orderValuePaise,
        requiredBy: dateStringToDate(input.requiredBy),
        status: ORDER_STATUS.ORDER_CREATED,
        statusHistory: [{ from: null, to: ORDER_STATUS.ORDER_CREATED, at: now, by: actor.id, byRole: actor.role }],
        buyerNotes: input.buyerNotes ?? null,
        createdBy: actor.id,
        createdByRole: actor.role,
      },
      session,
    );

    await recordAudit(
      {
        action: 'ORDER_CREATED',
        entityType: 'Order',
        entityId: order._id,
        orderId: order._id,
        after: {
          orderNumber,
          buyerId: String(buyer._id),
          productId: String(product._id),
          quantityCm,
          requiredYarnGrams,
          orderValuePaise,
          requiredBy: input.requiredBy,
        },
      },
      context,
      session,
    );

    return { statusCode: 201, body: { order: toPublicOrder(order, actor) } };
  });
}

export async function listOrders({ status, productId, buyerId, page, limit }, actor) {
  let scopedBuyerId = buyerId;
  if (actor.role === ROLES.BUYER) {
    // Fail closed: an unlinked buyer account sees nothing rather than everything.
    if (!actor.buyerId) return { orders: [], meta: { page, limit, total: 0 } };
    scopedBuyerId = actor.buyerId;
  }
  const { orders, total } = await findOrdersPage({ buyerId: scopedBuyerId, status, productId }, { page, limit });
  return { orders: orders.map((order) => toPublicOrder(order, actor)), meta: { page, limit, total } };
}

export async function getOrder(id, actor) {
  const order = await findOrderById(id);
  // Someone else's order looks exactly like a missing one: order ids cannot be probed.
  if (!order || !isOwnedBy(order, actor)) throw notFound();
  return toPublicOrder(order, actor);
}

const ACTIONS = Object.freeze({
  CANCEL: { to: ORDER_STATUS.CANCELLED, audit: 'ORDER_CANCELLED' },
  REJECT: { to: ORDER_STATUS.REJECTED, audit: 'ORDER_REJECTED' },
});

/**
 * Status change through the transition table. Role checks (who may cancel/reject) are on the
 * routes; ownership and state are checked here. The update is guarded on the status we read,
 * so a concurrent change makes this one fail with 409 instead of overwriting it.
 */
function changeStatus(orderId, actionName, { reason }, context) {
  const action = ACTIONS[actionName];
  const { actor } = context;

  return executeIdempotent(
    { context, operation: `ORDER_${actionName}`, request: { orderId, reason } },
    async (session) => {
      const order = await findOrderById(orderId, { session });
      if (!order || !isOwnedBy(order, actor)) throw notFound();

      const invalid = () =>
        new AppError('INVALID_STATE_TRANSITION', `An order in status ${order.status} cannot become ${action.to}`, {
          details: { from: order.status, to: action.to, allowed: allowedNextStatuses(order.status) },
        });
      if (!canTransition(order.status, action.to)) throw invalid();

      const updated = await transitionStatusGuarded(
        order._id,
        order.status,
        action.to,
        { from: order.status, to: action.to, at: new Date(), by: actor.id, byRole: actor.role, reason },
        session,
      );
      if (!updated) throw invalid();

      await recordAudit(
        {
          action: action.audit,
          entityType: 'Order',
          entityId: order._id,
          orderId: order._id,
          before: { status: order.status },
          after: { status: action.to, reason },
        },
        context,
        session,
      );

      return { statusCode: 200, body: { order: toPublicOrder(updated, actor) } };
    },
  );
}

export const cancelOrder = (orderId, input, context) => changeStatus(orderId, 'CANCEL', input, context);
export const rejectOrder = (orderId, input, context) => changeStatus(orderId, 'REJECT', input, context);
