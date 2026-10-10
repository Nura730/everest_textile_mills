import mongoose from 'mongoose';
import { CHECK_RESULT, FEASIBILITY_CHECK, FEASIBILITY_STATUS } from '../constants/feasibility.js';
import { ALL_ORDER_STATUSES, ORDER_STATUS } from '../constants/orderStatus.js';
import { ROLES } from '../constants/roles.js';
import { dateToDateString } from '../utils/dates.js';
import { cmToMetres, gramsToKg } from '../utils/units.js';

const { Schema } = mongoose;

const integer = { validator: Number.isInteger, message: '{PATH} must be an integer' };

// Copied from the catalog when the order is created: later catalog edits never change an order.
const productSnapshotSchema = new Schema(
  {
    code: { type: String, required: true },
    name: { type: String, required: true },
    material: { type: String, required: true },
    colour: { type: String, required: true },
    yarnGramsPerMetre: { type: Number, required: true, validate: integer },
    pricePerMetrePaise: { type: Number, required: true, validate: integer },
  },
  { _id: false },
);

const buyerSnapshotSchema = new Schema(
  {
    code: { type: String, required: true },
    name: { type: String, required: true },
  },
  { _id: false },
);

// Small and bounded (one entry per transition): feeds the buyer timeline in Phase 11.
// The audit log remains the complete, append-only record.
const statusChangeSchema = new Schema(
  {
    from: { type: String, enum: [...ALL_ORDER_STATUSES, null], default: null },
    to: { type: String, required: true, enum: ALL_ORDER_STATUSES },
    at: { type: Date, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    byRole: { type: String, required: true },
    reason: { type: String, default: null },
  },
  { _id: false },
);

// The feasibility verdict the order was confirmed on (Phase 6): what the factory knew and decided.
const feasibilityCheckSchema = new Schema(
  {
    code: { type: String, required: true, enum: Object.values(FEASIBILITY_CHECK) },
    result: { type: String, required: true, enum: Object.values(CHECK_RESULT) },
    message: { type: String, required: true },
  },
  { _id: false },
);

const feasibilitySchema = new Schema(
  {
    status: { type: String, required: true, enum: Object.values(FEASIBILITY_STATUS) },
    checks: { type: [feasibilityCheckSchema], required: true },
    inputs: {
      requiredYarnGrams: { type: Number, required: true, validate: integer },
      stockTotalGrams: { type: Number, required: true, validate: integer },
      stockReservedGrams: { type: Number, required: true, validate: integer },
      committedGrams: { type: Number, required: true, validate: integer },
      freeGrams: { type: Number, required: true, validate: integer },
      shortfallGrams: { type: Number, required: true, validate: integer },
      requiredBy: { type: String, required: true },
      assessedOn: { type: String, required: true },
      daysToDeadline: { type: Number, required: true, validate: integer },
    },
    computedAt: { type: Date, required: true },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'Buyer', required: true },
    buyer: { type: buyerSnapshotSchema, required: true },
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    product: { type: productSnapshotSchema, required: true },
    quantityCm: { type: Number, required: true, min: 1, validate: integer },
    requiredYarnGrams: { type: Number, required: true, min: 1, validate: integer },
    orderValuePaise: { type: Number, required: true, min: 0, validate: integer },
    requiredBy: { type: Date, required: true },
    status: { type: String, required: true, enum: ALL_ORDER_STATUSES, default: ORDER_STATUS.ORDER_CREATED },
    statusHistory: { type: [statusChangeSchema], default: [] },
    buyerNotes: { type: String, trim: true, maxlength: 500, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    createdByRole: { type: String, required: true },
    // Set on confirmation (Phase 6).
    feasibility: { type: feasibilitySchema, default: null },
    confirmedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// A buyer's own order list, newest first.
orderSchema.index({ buyerId: 1, createdAt: -1 });
// The internal work queue: orders in a status, by deadline.
orderSchema.index({ status: 1, requiredBy: 1 });
// The admin/staff list, newest first.
orderSchema.index({ createdAt: -1 });

/** A feasibility result (stored snapshot or live check) as the API returns it: kg, not grams. */
export function toPublicFeasibility(feasibility) {
  const { inputs } = feasibility;
  return {
    status: feasibility.status,
    checks: feasibility.checks.map(({ code, result, message }) => ({ code, result, message })),
    inputs: {
      requiredYarnKg: gramsToKg(inputs.requiredYarnGrams),
      stockTotalKg: gramsToKg(inputs.stockTotalGrams),
      stockReservedKg: gramsToKg(inputs.stockReservedGrams),
      stockAvailableKg: gramsToKg(inputs.stockTotalGrams - inputs.stockReservedGrams),
      committedKg: gramsToKg(inputs.committedGrams),
      freeKg: gramsToKg(inputs.freeGrams),
      shortfallKg: gramsToKg(inputs.shortfallGrams),
      requiredBy: inputs.requiredBy,
      assessedOn: inputs.assessedOn,
      daysToDeadline: inputs.daysToDeadline,
    },
    computedAt: feasibility.computedAt,
  };
}

/**
 * What a viewer may see of an order:
 *  - money (price, order value): ADMIN and the owning BUYER only;
 *  - planning data (yarn requirement, feasibility, who confirmed) and who changed the status:
 *    internal roles only. A buyer sees that the order was confirmed, not the factory's stock.
 * Ownership itself is checked in the service before this is called.
 */
export function toPublicOrder(order, viewer) {
  const isBuyer = viewer.role === ROLES.BUYER;
  const seesMoney = isBuyer || viewer.role === ROLES.ADMIN;

  const publicOrder = {
    id: String(order._id),
    orderNumber: order.orderNumber,
    status: order.status,
    buyer: { id: String(order.buyerId), code: order.buyer.code, name: order.buyer.name },
    product: {
      id: String(order.productId),
      code: order.product.code,
      name: order.product.name,
      material: order.product.material,
      colour: order.product.colour,
    },
    quantityMetres: cmToMetres(order.quantityCm),
    requiredBy: dateToDateString(order.requiredBy),
    buyerNotes: order.buyerNotes ?? null,
    statusHistory: order.statusHistory.map((change) => {
      const entry = { from: change.from ?? null, to: change.to, at: change.at, byRole: change.byRole, reason: change.reason ?? null };
      if (!isBuyer) entry.by = String(change.by);
      return entry;
    }),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
  if (seesMoney) {
    publicOrder.pricePerMetrePaise = order.product.pricePerMetrePaise;
    publicOrder.orderValuePaise = order.orderValuePaise;
  }
  if (!isBuyer) {
    publicOrder.requiredYarnKg = gramsToKg(order.requiredYarnGrams);
    publicOrder.createdBy = String(order.createdBy);
    publicOrder.feasibility = order.feasibility ? toPublicFeasibility(order.feasibility) : null;
    publicOrder.confirmedBy = order.confirmedBy ? String(order.confirmedBy) : null;
  }
  return publicOrder;
}

export const Order = mongoose.model('Order', orderSchema);
