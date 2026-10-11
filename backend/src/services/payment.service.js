import { recordAudit } from '../audit/recordAudit.js';
import { getConfig } from '../config/env.js';
import { ROLES } from '../constants/roles.js';
import { Invoice, toPublicInvoice } from '../models/Fulfilment.js';
import { PAYMENT_KIND, Payment, toPublicPayment } from '../models/Payment.js';
import { claimLock } from '../repositories/locks.repository.js';
import { AppError } from '../utils/AppError.js';
import { addDaysToDateString, dateToDateString, todayInIndia } from '../utils/dates.js';
import { executeIdempotent } from './idempotency.service.js';

/*
 * Buyer payments against invoices (ADMIN records; the owning buyer reads). Invoiced and paid are separate
 * states: an invoice is UNPAID until money is recorded, PARTIALLY_PAID, or PAID; it is OVERDUE once its
 * due date (issue date + PAYMENT_TERMS_DAYS) has passed with money outstanding. Payments are append-only;
 * a mistake is undone with a reversal entry, never by editing. A payment can never exceed what is still
 * owed (no silent credit balances).
 */

export const PAYMENT_STATUS = Object.freeze({ UNPAID: 'UNPAID', PARTIALLY_PAID: 'PARTIALLY_PAID', PAID: 'PAID' });

const lockInvoice = (id, session) => claimLock(`invoice:${id}`, session);
const notFound = (what) => new AppError('NOT_FOUND', `${what} not found`);
const buyerScope = (actor) => (actor.role === ROLES.BUYER ? { buyerId: actor.buyerId ?? '000000000000000000000000' } : {});

/** Due date and payment state of an invoice given what was paid. Pure. */
export function paymentState(invoice, paidPaise, { today = todayInIndia(), termsDays = getConfig().paymentTermsDays } = {}) {
  const issuedOn = dateToDateString(new Date(new Date(invoice.issuedAt).getTime() + 330 * 60_000));
  const dueDate = addDaysToDateString(issuedOn, termsDays);
  const outstandingPaise = Math.max(0, invoice.totalPaise - paidPaise);
  const status = paidPaise <= 0 ? PAYMENT_STATUS.UNPAID : outstandingPaise === 0 ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.PARTIALLY_PAID;
  const overdue = outstandingPaise > 0 && today > dueDate;
  const daysOverdue = overdue ? Math.round((new Date(`${today}T00:00:00Z`) - new Date(`${dueDate}T00:00:00Z`)) / 86_400_000) : 0;
  return { dueDate, paidPaise, outstandingPaise, status, overdue, daysOverdue };
}

/** Paid amount per invoice id (receipts minus reversals). */
export async function paidByInvoice(invoiceIds, session = null) {
  if (invoiceIds.length === 0) return new Map();
  const rows = await Payment.aggregate([{ $match: { invoiceId: { $in: invoiceIds } } }, { $group: { _id: '$invoiceId', paid: { $sum: '$amountPaise' } } }]).session(session);
  return new Map(rows.map((r) => [String(r._id), r.paid]));
}

/** Invoices as the API returns them, each with its payment state. */
export async function withPayments(invoices) {
  const paid = await paidByInvoice(invoices.map((i) => i._id));
  return invoices.map((inv) => ({ ...toPublicInvoice(inv), payment: paymentState(inv, paid.get(String(inv._id)) ?? 0) }));
}

async function loadInvoice(id, actor, session = null) {
  const invoice = await Invoice.findOne({ _id: id, ...buyerScope(actor) }).session(session).lean();
  if (!invoice) throw notFound('Invoice');
  return invoice;
}

/** The payments of one invoice (ADMIN, owning BUYER), oldest first, with reversals marked. */
export async function listInvoicePayments(invoiceId, actor) {
  const invoice = await loadInvoice(invoiceId, actor);
  const entries = await Payment.find({ invoiceId: invoice._id }).sort({ createdAt: 1, _id: 1 }).lean();
  const reversed = new Set(entries.filter((p) => p.reversesPaymentId).map((p) => String(p.reversesPaymentId)));
  return { payments: entries.map((p) => toPublicPayment(p, { reversed: reversed.has(String(p._id)) })) };
}

/** Record money received against an invoice (ADMIN; Idempotency-Key). Never more than is owed. */
export function recordPayment(invoiceId, { amountPaise, receivedOn, method, reference, note }, context) {
  return executeIdempotent({ context, operation: 'PAYMENT_RECORD', request: { invoiceId, amountPaise, receivedOn, method, reference: reference ?? null, note: note ?? null } }, async (session) => {
    if (receivedOn > todayInIndia()) {
      throw new AppError('VALIDATION_ERROR', 'Request validation failed', { details: [{ location: 'body', path: 'receivedOn', message: 'cannot be in the future' }] });
    }
    const invoice = await loadInvoice(invoiceId, context.actor, session);
    await lockInvoice(invoice._id, session);
    const paid = (await paidByInvoice([invoice._id], session)).get(String(invoice._id)) ?? 0;
    const outstanding = invoice.totalPaise - paid;
    if (amountPaise > outstanding) {
      throw new AppError('OVERPAYMENT', outstanding === 0 ? `${invoice.invoiceNumber} is already fully paid` : `Only ${(outstanding / 100).toFixed(2)} is still owed on ${invoice.invoiceNumber}`, {
        details: { outstandingPaise: outstanding, requestedPaise: amountPaise },
      });
    }
    const [payment] = await Payment.create(
      [{
        kind: PAYMENT_KIND.RECEIPT, invoiceId: invoice._id, invoiceNumber: invoice.invoiceNumber, orderId: invoice.orderId, buyerId: invoice.buyerId, buyerName: invoice.buyer.name,
        amountPaise, receivedOn, method, reference: reference ?? null, note: note ?? null, recordedBy: context.actor.id, recordedByRole: context.actor.role,
      }],
      { session },
    );
    await recordAudit(
      { action: 'PAYMENT_RECORDED', entityType: 'Invoice', entityId: invoice._id, orderId: invoice.orderId, after: { invoiceNumber: invoice.invoiceNumber, amountPaise, receivedOn, method, reference: reference ?? null } },
      context,
      session,
    );
    return { statusCode: 201, body: { payment: toPublicPayment(payment.toObject()), invoice: { ...toPublicInvoice(invoice), payment: paymentState(invoice, paid + amountPaise) } } };
  });
}

/** Undo a payment recorded by mistake (ADMIN; reason required; once per payment). */
export function reversePayment(paymentId, { reason }, context) {
  return executeIdempotent({ context, operation: 'PAYMENT_REVERSE', request: { paymentId, reason } }, async (session) => {
    const original = await Payment.findById(paymentId).session(session).lean();
    if (!original) throw notFound('Payment');
    if (original.kind !== PAYMENT_KIND.RECEIPT) throw new AppError('INVALID_STATE_TRANSITION', 'A reversal cannot itself be reversed');
    await lockInvoice(original.invoiceId, session);
    if (await Payment.exists({ reversesPaymentId: original._id }).session(session)) throw new AppError('DUPLICATE_RESOURCE', 'This payment was already reversed', { details: { fields: ['reversesPaymentId'] } });
    let reversal;
    try {
      [reversal] = await Payment.create(
        [{
          kind: PAYMENT_KIND.REVERSAL, invoiceId: original.invoiceId, invoiceNumber: original.invoiceNumber, orderId: original.orderId, buyerId: original.buyerId, buyerName: original.buyerName,
          amountPaise: -original.amountPaise, receivedOn: todayInIndia(), method: original.method, reference: original.reference, note: reason,
          reversesPaymentId: original._id, recordedBy: context.actor.id, recordedByRole: context.actor.role,
        }],
        { session },
      );
    } catch (err) {
      if (err?.code === 11000) throw new AppError('DUPLICATE_RESOURCE', 'This payment was already reversed', { details: { fields: ['reversesPaymentId'] } });
      throw err;
    }
    await recordAudit(
      { action: 'PAYMENT_REVERSED', entityType: 'Invoice', entityId: original.invoiceId, orderId: original.orderId, before: { paymentId: String(original._id), amountPaise: original.amountPaise }, after: { reason } },
      context,
      session,
    );
    return { statusCode: 201, body: { payment: toPublicPayment(reversal.toObject()) } };
  });
}

/**
 * Who owes what (ADMIN): every invoice with money outstanding, grouped by buyer, with ageing buckets
 * by days past the due date (not yet due, 1-30, 31-60, over 60).
 */
export async function receivables({ today = todayInIndia() } = {}) {
  const invoices = await Invoice.find({}).sort({ issuedAt: 1 }).lean();
  const paid = await paidByInvoice(invoices.map((i) => i._id));
  const open = invoices
    .map((inv) => ({ inv, state: paymentState(inv, paid.get(String(inv._id)) ?? 0, { today }) }))
    .filter((x) => x.state.outstandingPaise > 0);
  const bucket = (s) => (!s.overdue ? 'notDue' : s.daysOverdue <= 30 ? 'd1to30' : s.daysOverdue <= 60 ? 'd31to60' : 'over60');
  const buyers = new Map();
  for (const { inv, state } of open) {
    const key = String(inv.buyerId);
    const row = buyers.get(key) ?? { buyerId: key, buyerName: inv.buyer.name, invoices: 0, outstandingPaise: 0, notDue: 0, d1to30: 0, d31to60: 0, over60: 0 };
    row.invoices += 1;
    row.outstandingPaise += state.outstandingPaise;
    row[bucket(state)] += state.outstandingPaise;
    buyers.set(key, row);
  }
  const byBuyer = [...buyers.values()].sort((a, b) => b.outstandingPaise - a.outstandingPaise);
  const sum = (k) => byBuyer.reduce((s, r) => s + r[k], 0);
  return {
    asOf: today,
    totals: { outstandingPaise: sum('outstandingPaise'), notDue: sum('notDue'), d1to30: sum('d1to30'), d31to60: sum('d31to60'), over60: sum('over60'), invoices: open.length },
    byBuyer,
    invoices: open.map(({ inv, state }) => ({ id: String(inv._id), invoiceNumber: inv.invoiceNumber, orderNumber: inv.orderNumber, buyerName: inv.buyer.name, totalPaise: inv.totalPaise, ...state })),
  };
}
