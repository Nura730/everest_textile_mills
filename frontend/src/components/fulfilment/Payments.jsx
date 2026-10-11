import { useState } from 'react';
import { newIdempotencyKey } from '../../api/client.js';
import { fulfilmentApi } from '../../api/endpoints.js';
import { formatDate, formatPaise, rupeesToPaise } from '../../utils/format.js';
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, paymentTone } from '../../utils/payments.js';
import { todayInIndia } from '../../utils/attendance.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { ConfirmDialog, Field, Modal } from '../ui/Modal.jsx';
import { StatusBadge } from '../ui/StatusBadge.jsx';
import { ErrorState, LoadingState } from '../ui/States.jsx';
import { useToast } from '../ui/Toast.jsx';

/** Paid / partly paid / unpaid (and overdue) for one invoice's payment state. */
export function PaymentBadge({ payment }) {
  if (!payment) return null;
  const label = `${PAYMENT_STATUS_LABELS[payment.status] ?? payment.status}${payment.overdue ? ` · ${payment.daysOverdue} day(s) overdue` : ''}`;
  return <StatusBadge tone={paymentTone(payment)} label={label} />;
}

/**
 * Payments of one invoice: due date, what was paid and what is owed, every payment entry; the admin
 * records payments (never more than is owed) and reverses a mistaken one with a reason.
 */
export function InvoicePayments({ invoice, canRecord, onChanged }) {
  const list = useApiQuery(() => fulfilmentApi.invoicePayments(invoice.id), [invoice.id, invoice.payment?.paidPaise]);
  const [recording, setRecording] = useState(false);
  const [reversing, setReversing] = useState(null);
  const toast = useToast();
  const p = invoice.payment;
  const payments = list.data?.payments ?? [];

  async function reverse() {
    setReversing({ ...reversing, busy: true });
    try {
      await fulfilmentApi.reversePayment(reversing.payment.id, reversing.reason.trim(), reversing.key);
      toast.success('Payment reversed. The original entry is kept and marked reversed.');
      setReversing(null);
      list.reload();
      onChanged?.();
    } catch (err) {
      setReversing({ ...reversing, busy: false, error: err.message });
    }
  }

  return (
    <div className="erp-card section-gap">
      <div className="card-header">
        <div>
          <h3 className="card-title">Payment</h3>
          <p className="card-subtitle">
            Due {formatDate(p.dueDate)} · paid {formatPaise(p.paidPaise)} of {formatPaise(invoice.totalPaise)} · owed {formatPaise(p.outstandingPaise)}
          </p>
        </div>
        <div className="row-actions">
          <PaymentBadge payment={p} />
          {canRecord && p.outstandingPaise > 0 && <button type="button" className="erp-btn-primary" onClick={() => setRecording(true)}>Record payment</button>}
        </div>
      </div>
      {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
      {!list.error && !list.data && <LoadingState />}
      {list.data && payments.length === 0 && <p className="cell-sub">No payment recorded yet. Issuing an invoice does not record a payment.</p>}
      {payments.length > 0 && (
        <table className="erp-data-table">
          <thead><tr><th scope="col">Received</th><th scope="col">Method</th><th scope="col">Reference</th><th scope="col" className="num">Amount</th><th scope="col">Note</th>{canRecord && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
          <tbody>
            {payments.map((pay) => (
              <tr key={pay.id}>
                <td>{formatDate(pay.receivedOn)}</td>
                <td>{pay.kind === 'REVERSAL' ? 'Reversal' : PAYMENT_METHOD_LABELS[pay.method] ?? '—'}</td>
                <td className="mono">{pay.reference ?? '—'}</td>
                <td className="num">{formatPaise(pay.amountPaise)}</td>
                <td>{pay.note ?? '—'}{pay.reversed && <span className="cell-sub"> · reversed</span>}</td>
                {canRecord && (
                  <td className="row-actions">
                    {pay.kind === 'RECEIPT' && !pay.reversed && <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setReversing({ payment: pay, reason: '', key: newIdempotencyKey() })}>Reverse</button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {recording && <RecordPaymentModal invoice={invoice} onClose={() => setRecording(false)} onDone={() => { setRecording(false); list.reload(); onChanged?.(); }} />}
      {reversing && (
        <ConfirmDialog
          title={`Reverse the payment of ${formatPaise(reversing.payment.amountPaise)}?`}
          message="Use this when a payment was recorded by mistake or a cheque bounced. A reversal entry is added; nothing is deleted."
          confirmLabel="Reverse payment"
          danger
          busy={reversing.busy}
          reason={reversing.reason}
          reasonError={reversing.error}
          onReasonChange={(reason) => setReversing({ ...reversing, reason, error: null, key: newIdempotencyKey() })}
          onConfirm={() => (reversing.reason.trim().length < 5 ? setReversing({ ...reversing, error: 'Give the reason (at least 5 characters).' }) : reverse())}
          onClose={() => setReversing(null)}
        />
      )}
    </div>
  );
}

function RecordPaymentModal({ invoice, onClose, onDone }) {
  const toast = useToast();
  const [today] = useState(todayInIndia);
  const [form, setForm] = useState({ amount: String(invoice.payment.outstandingPaise / 100), receivedOn: today, method: 'BANK_TRANSFER', reference: '', note: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const set = (field) => (e) => { setForm({ ...form, [field]: e.target.value }); setError(null); setKey(newIdempotencyKey()); };

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const amountPaise = rupeesToPaise(form.amount);
    if (!amountPaise) return setError('Enter the amount received in rupees (above 0, at most 2 decimals).');
    if (amountPaise > invoice.payment.outstandingPaise) return setError(`At most ${formatPaise(invoice.payment.outstandingPaise)} is still owed.`);
    setBusy(true);
    try {
      await fulfilmentApi.recordPayment(invoice.id, { amountPaise, receivedOn: form.receivedOn, method: form.method, ...(form.reference.trim() ? { reference: form.reference.trim() } : {}), ...(form.note.trim() ? { note: form.note.trim() } : {}) }, key);
      toast.success(`${formatPaise(amountPaise)} recorded against ${invoice.invoiceNumber}.`, { title: 'Payment recorded' });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Record a payment for ${invoice.invoiceNumber}`}
      subtitle={`${formatPaise(invoice.payment.outstandingPaise)} is still owed by ${invoice.buyer.name}.`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="payment-form" className="erp-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Record payment'}</button>
        </>
      }
    >
      <form id="payment-form" className="erp-form-grid" onSubmit={submit} noValidate>
        <Field label="Amount received (₹)" htmlFor="pay-amount" required>
          <input id="pay-amount" className="erp-input" inputMode="decimal" value={form.amount} onChange={set('amount')} disabled={busy} />
        </Field>
        <Field label="Received on" htmlFor="pay-date" required>
          <input id="pay-date" type="date" className="erp-input" max={today} value={form.receivedOn} onChange={set('receivedOn')} disabled={busy} />
        </Field>
        <Field label="Method" htmlFor="pay-method" required>
          <select id="pay-method" className="erp-input" value={form.method} onChange={set('method')} disabled={busy}>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="Reference (UTR / cheque no.)" htmlFor="pay-ref" required>
          <input id="pay-ref" className="erp-input" maxLength={60} value={form.reference} onChange={set('reference')} disabled={busy} />
        </Field>
        <Field label="Note" htmlFor="pay-note">
          <input id="pay-note" className="erp-input" maxLength={500} value={form.note} onChange={set('note')} disabled={busy} />
        </Field>
        {error && <p className="login-field-error" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
