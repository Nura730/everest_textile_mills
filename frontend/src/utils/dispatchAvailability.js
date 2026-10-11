import { formatNumber } from './format.js';

// Display of GET /api/finished-goods/availability (pure; tested in dispatchAvailability.test.js).
// The numbers and the reason come from the server; nothing is computed from the order's target.

/** { canPrepare, label, detail } for one order's availability. */
export function describeAvailability(a) {
  if (!a) return { canPrepare: false, label: '…', detail: null };
  const parts = [];
  if (a.reserved.metres > 0) parts.push(`${formatNumber(a.reserved.metres, 'm')} in ${a.reserved.dispatches.map((d) => d.dispatchNumber).join(', ')} (awaiting confirmation)`);
  if (a.awaitingQc.rolls > 0) parts.push(`${a.awaitingQc.rolls} roll(s) awaiting QC`);
  if (a.rejected.rolls > 0) parts.push(`${formatNumber(a.rejected.metres, 'm')} rejected`);
  if (a.dispatched.metres > 0) parts.push(`${formatNumber(a.dispatched.metres, 'm')} already dispatched`);
  return {
    canPrepare: a.dispatchableMetres > 0,
    label: a.dispatchableMetres > 0 ? `${formatNumber(a.dispatchableMetres, 'm')} in stock` : 'Nothing to prepare',
    detail: a.dispatchableMetres > 0 ? (parts.join(' · ') || null) : a.message,
  };
}
