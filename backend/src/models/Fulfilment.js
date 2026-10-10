import mongoose from 'mongoose';
import { cmToMetres } from '../utils/units.js';

const { Schema } = mongoose;

const integer = { validator: Number.isInteger, message: '{PATH} must be an integer' };

export const FG_STATUS = Object.freeze({ IN_STOCK: 'IN_STOCK', RESERVED_FOR_DISPATCH: 'RESERVED_FOR_DISPATCH', DISPATCHED: 'DISPATCHED' });
export const DISPATCH_STATUS = Object.freeze({ PREPARED: 'PREPARED', CONFIRMED: 'CONFIRMED', CANCELLED: 'CANCELLED' });

// GST on woven cotton/synthetic fabric (HSN 5208–5407) is 5% (assumption, stated on every invoice).
export const DEFAULT_TAX_RATE_BASIS_POINTS = 500;

/**
 * A finished good (Phase 11): one QC-passed roll, in stock. Only finished goods can be dispatched,
 * and only from IN_STOCK; a rejected roll never gets one (rollId is unique).
 */
const finishedGoodSchema = new Schema(
  {
    rollId: { type: Schema.Types.ObjectId, ref: 'Roll', required: true, unique: true },
    rollNumber: { type: String, required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    orderNumber: { type: String, required: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'Buyer', required: true },
    buyerName: { type: String, required: true },
    productName: { type: String, required: true },
    material: { type: String, required: true },
    colour: { type: String, required: true },
    lengthCm: { type: Number, required: true, min: 1, validate: integer },
    location: { type: String, trim: true, maxlength: 60, default: 'FG store' },
    status: { type: String, required: true, enum: Object.values(FG_STATUS), default: FG_STATUS.IN_STOCK },
    dispatchId: { type: Schema.Types.ObjectId, ref: 'Dispatch', default: null },
  },
  { timestamps: true },
);
finishedGoodSchema.index({ orderId: 1, status: 1 });
finishedGoodSchema.index({ status: 1, createdAt: -1 });

export function toPublicFinishedGood(fg) {
  return {
    id: String(fg._id),
    rollId: String(fg.rollId),
    rollNumber: fg.rollNumber,
    orderId: String(fg.orderId),
    orderNumber: fg.orderNumber,
    buyerId: String(fg.buyerId),
    buyerName: fg.buyerName,
    productName: fg.productName,
    material: fg.material,
    colour: fg.colour,
    lengthMetres: cmToMetres(fg.lengthCm),
    location: fg.location,
    qcStatus: 'PASSED',
    status: fg.status,
    dispatchId: fg.dispatchId ? String(fg.dispatchId) : null,
    createdAt: fg.createdAt,
    updatedAt: fg.updatedAt,
  };
}

/**
 * A dispatch (Phase 12): chosen finished goods of one order. PREPARED reserves them; CONFIRMED (signed
 * by the store keeper) dispatches them; CANCELLED puts them back in stock.
 */
const dispatchSchema = new Schema(
  {
    dispatchNumber: { type: String, required: true, unique: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    orderNumber: { type: String, required: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'Buyer', required: true },
    buyerName: { type: String, required: true },
    lines: {
      type: [{ finishedGoodId: { type: Schema.Types.ObjectId, ref: 'FinishedGood', required: true }, rollNumber: String, lengthCm: { type: Number, validate: integer }, _id: false }],
      required: true,
    },
    totalLengthCm: { type: Number, required: true, min: 1, validate: integer },
    vehicleNumber: { type: String, trim: true, maxlength: 20, default: null },
    notes: { type: String, trim: true, maxlength: 500, default: null },
    status: { type: String, required: true, enum: Object.values(DISPATCH_STATUS), default: DISPATCH_STATUS.PREPARED },
    preparedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    confirmedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    confirmedAt: { type: Date, default: null },
    signatureId: { type: Schema.Types.ObjectId, ref: 'Signature', default: null },
    cancelledReason: { type: String, default: null },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null },
  },
  { timestamps: true },
);
dispatchSchema.index({ orderId: 1, createdAt: 1 });
dispatchSchema.index({ status: 1, createdAt: -1 });

export function toPublicDispatch(d) {
  return {
    id: String(d._id),
    dispatchNumber: d.dispatchNumber,
    orderId: String(d.orderId),
    orderNumber: d.orderNumber,
    buyerName: d.buyerName,
    lines: d.lines.map((l) => ({ finishedGoodId: String(l.finishedGoodId), rollNumber: l.rollNumber, lengthMetres: cmToMetres(l.lengthCm) })),
    rollCount: d.lines.length,
    totalMetres: cmToMetres(d.totalLengthCm),
    vehicleNumber: d.vehicleNumber ?? null,
    notes: d.notes ?? null,
    status: d.status,
    confirmedAt: d.confirmedAt,
    signed: Boolean(d.signatureId),
    cancelledReason: d.cancelledReason ?? null,
    invoiceId: d.invoiceId ? String(d.invoiceId) : null,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

/**
 * An invoice (Phase 12) for one confirmed dispatch (dispatchId unique), priced from the order's own
 * price snapshot. Integer paise throughout; issued invoices are never edited (append-only by design:
 * the service only inserts).
 */
const invoiceSchema = new Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    orderNumber: { type: String, required: true },
    dispatchId: { type: Schema.Types.ObjectId, ref: 'Dispatch', required: true, unique: true },
    dispatchNumber: { type: String, required: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'Buyer', required: true },
    buyer: { code: String, name: String, address: String },
    lines: {
      type: [{ description: String, lengthCm: { type: Number, validate: integer }, pricePerMetrePaise: { type: Number, validate: integer }, amountPaise: { type: Number, validate: integer }, _id: false }],
      required: true,
    },
    subtotalPaise: { type: Number, required: true, validate: integer },
    taxRateBasisPoints: { type: Number, required: true, validate: integer },
    taxPaise: { type: Number, required: true, validate: integer },
    totalPaise: { type: Number, required: true, validate: integer },
    issuedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    issuedAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
invoiceSchema.index({ buyerId: 1, issuedAt: -1 });
invoiceSchema.index({ orderId: 1 });

export function toPublicInvoice(inv) {
  return {
    id: String(inv._id),
    invoiceNumber: inv.invoiceNumber,
    orderId: String(inv.orderId),
    orderNumber: inv.orderNumber,
    dispatchId: String(inv.dispatchId),
    dispatchNumber: inv.dispatchNumber,
    buyer: { code: inv.buyer.code, name: inv.buyer.name, address: inv.buyer.address ?? null },
    lines: inv.lines.map((l) => ({ description: l.description, lengthMetres: cmToMetres(l.lengthCm), pricePerMetrePaise: l.pricePerMetrePaise, amountPaise: l.amountPaise })),
    subtotalPaise: inv.subtotalPaise,
    taxRateBasisPoints: inv.taxRateBasisPoints,
    taxPaise: inv.taxPaise,
    totalPaise: inv.totalPaise,
    issuedAt: inv.issuedAt,
  };
}

export const FinishedGood = mongoose.model('FinishedGood', finishedGoodSchema);
export const Dispatch = mongoose.model('Dispatch', dispatchSchema);
export const Invoice = mongoose.model('Invoice', invoiceSchema);
