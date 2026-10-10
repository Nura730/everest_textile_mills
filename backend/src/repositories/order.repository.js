import { Counter } from '../models/Counter.js';
import { Order } from '../models/Order.js';

/**
 * Next value of a named sequence. Called inside the order-creation transaction, so:
 *  - a failed creation rolls the increment back (no gaps from failures);
 *  - two concurrent creations conflict on the counter document and MongoDB serialises them, so
 *    they get different numbers. The unique index on orderNumber is the final guard.
 */
export async function nextSequence(name, session) {
  const counter = await Counter.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after', session, lean: true },
  );
  return counter.seq;
}

export async function insertOrder(data, session) {
  const [order] = await Order.create([data], { session });
  return order;
}

export function findOrderById(id, { session } = {}) {
  return Order.findById(id).session(session ?? null).lean();
}

export async function findOrdersPage({ buyerId, status, productId }, { page, limit }) {
  const filter = {};
  if (buyerId) filter.buyerId = buyerId;
  if (status) filter.status = status;
  if (productId) filter.productId = productId;
  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Order.countDocuments(filter),
  ]);
  return { orders, total };
}

/**
 * Yarn grams required by the orders of one material and colour in `status`, optionally leaving
 * one order out (the one being assessed).
 */
export async function sumOrderYarnGrams({ material, colour, status, excludeOrderId }, { session } = {}) {
  const match = { 'product.material': material, 'product.colour': colour, status };
  if (excludeOrderId) match._id = { $ne: excludeOrderId };
  const [row] = await Order.aggregate([
    { $match: match },
    { $group: { _id: null, grams: { $sum: '$requiredYarnGrams' } } },
  ]).session(session ?? null);
  return row?.grams ?? 0;
}

/**
 * Moves an order from `from` to `to` only if it is still in `from` at the moment of the write
 * (check and write in one operation). `set` holds extra fields written with the change (e.g. the
 * feasibility snapshot on confirmation). Returns the updated order, or null if someone else
 * changed the status first.
 */
export function transitionStatusGuarded(orderId, from, to, change, session, set = {}) {
  return Order.findOneAndUpdate(
    { _id: orderId, status: from },
    { $set: { ...set, status: to }, $push: { statusHistory: change } },
    { returnDocument: 'after', session, lean: true },
  );
}
