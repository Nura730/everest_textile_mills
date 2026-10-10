import { Counter } from '../models/Counter.js';
import { DELIVERY_PENDING_STATUSES } from '../constants/orderStatus.js';
import { Order } from '../models/Order.js';
import { dateStringToDate } from '../utils/dates.js';
import { searchAcross } from '../utils/search.js';

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

const ORDER_SEARCH_FIELDS = ['orderNumber', 'buyer.code', 'buyer.name', 'product.code', 'product.name'];

/**
 * All filters combine (AND). `today` ("YYYY-MM-DD", India) is passed in so the query has no hidden
 * clock. requiredBy is stored as UTC midnight of its calendar date, so date strings compare exactly.
 */
export async function findOrdersPage(
  { buyerId, status, productId, requiredFrom, requiredTo, overdue, q, today },
  { page, limit },
) {
  const filter = { ...searchAcross(ORDER_SEARCH_FIELDS, q) };
  if (buyerId) filter.buyerId = buyerId;
  if (productId) filter.productId = productId;
  const requiredBy = {};
  if (requiredFrom) requiredBy.$gte = dateStringToDate(requiredFrom);
  if (requiredTo) requiredBy.$lte = dateStringToDate(requiredTo);
  if (overdue) {
    // Deadline passed while a delivery is still owed. A status filter narrows it further; a
    // closed status (e.g. CANCELLED) combined with overdue matches nothing.
    requiredBy.$lt = dateStringToDate(today);
    if (!status) filter.status = { $in: DELIVERY_PENDING_STATUSES };
    else filter.status = DELIVERY_PENDING_STATUSES.includes(status) ? status : { $in: [] };
  } else if (status) {
    filter.status = status;
  }
  if (Object.keys(requiredBy).length > 0) filter.requiredBy = requiredBy;
  const [orders, total] = await Promise.all([
    Order.find(filter).sort({ createdAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Order.countDocuments(filter),
  ]);
  return { orders, total };
}

/**
 * $set on an order only while it is still in `status` and unchanged since `updatedAt` was read.
 * Returns the updated order, or null.
 */
export function updateOrderIfUnchanged(orderId, { status, updatedAt }, set, session) {
  return Order.findOneAndUpdate(
    { _id: orderId, status, updatedAt },
    { $set: set },
    { returnDocument: 'after', session, lean: true },
  );
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
