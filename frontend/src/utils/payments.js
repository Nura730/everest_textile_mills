// Labels and colours for invoice payment state (the server computes the state).

export const PAYMENT_STATUS_LABELS = { UNPAID: 'Unpaid', PARTIALLY_PAID: 'Partly paid', PAID: 'Paid' };
export const PAYMENT_METHOD_LABELS = { BANK_TRANSFER: 'Bank transfer', UPI: 'UPI', CHEQUE: 'Cheque', CASH: 'Cash', OTHER: 'Other' };

/** Badge tone: paid green, overdue red, partly paid blue, unpaid amber. */
export function paymentTone(payment) {
  if (!payment) return 'neutral';
  if (payment.status === 'PAID') return 'success';
  if (payment.overdue) return 'danger';
  return payment.status === 'PARTIALLY_PAID' ? 'info' : 'warning';
}
