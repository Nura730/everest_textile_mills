import mongoose from 'mongoose';
import { appendOnly } from './plugins/appendOnly.js';

const { Schema } = mongoose;
const integer = { validator: Number.isInteger, message: '{PATH} must be an integer' };

export const PAYMENT_METHODS = Object.freeze(['BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH', 'OTHER']);
export const PAYMENT_KIND = Object.freeze({ RECEIPT: 'RECEIPT', REVERSAL: 'REVERSAL' });

/**
 * Money received from a buyer against one invoice (append-only, like the stock ledger). A payment
 * recorded by mistake is never edited or deleted: a REVERSAL entry with the opposite amount points at
 * it (once: reversesPaymentId is unique). An invoice's paid amount is the sum of its entries.
 * Issuing an invoice never records a payment: invoiced and paid stay separate states.
 */
const paymentSchema = new Schema(
  {
    kind: { type: String, required: true, enum: Object.values(PAYMENT_KIND) },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', required: true },
    invoiceNumber: { type: String, required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'Buyer', required: true },
    buyerName: { type: String, required: true },
    amountPaise: { type: Number, required: true, validate: integer }, // negative for a reversal
    receivedOn: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // Indian calendar date
    method: { type: String, enum: PAYMENT_METHODS, default: null },
    reference: { type: String, trim: true, maxlength: 60, default: null }, // UTR, cheque number…
    note: { type: String, trim: true, maxlength: 500, default: null },
    reversesPaymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    recordedByRole: { type: String, required: true },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
paymentSchema.index({ invoiceId: 1, createdAt: 1 });
paymentSchema.index({ receivedOn: 1 });
paymentSchema.index({ buyerId: 1, receivedOn: -1 });
paymentSchema.index({ reversesPaymentId: 1 }, { unique: true, partialFilterExpression: { reversesPaymentId: { $type: 'objectId' } } });
paymentSchema.plugin(appendOnly, { collectionLabel: 'payments' });

export function toPublicPayment(p, { reversed = false } = {}) {
  return {
    id: String(p._id),
    kind: p.kind,
    invoiceId: String(p.invoiceId),
    invoiceNumber: p.invoiceNumber,
    orderId: String(p.orderId),
    buyerName: p.buyerName,
    amountPaise: p.amountPaise,
    receivedOn: p.receivedOn,
    method: p.method ?? null,
    reference: p.reference ?? null,
    note: p.note ?? null,
    reversesPaymentId: p.reversesPaymentId ? String(p.reversesPaymentId) : null,
    reversed,
    recordedByRole: p.recordedByRole,
    createdAt: p.createdAt,
  };
}

export const Payment = mongoose.model('Payment', paymentSchema);
