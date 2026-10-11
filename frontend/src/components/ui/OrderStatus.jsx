import { Check, Circle, CircleDot, Clock, XCircle } from 'lucide-react';
import { daysUntil, formatDateTime } from '../../utils/format.js';
import { StatusBadge } from './StatusBadge.jsx';
import { ORDER_STEPS, STATUS_LABELS, isCompletedOrder, isOpenOrder, stepStates } from '../../utils/orderStatus.js';

export function OrderStatusBadge({ status }) {
  return <StatusBadge domain="ORDER" state={status} label={STATUS_LABELS[status] ?? status} />;
}

/** "Due in 5 days" / "Overdue by 2 days" — only for orders still in progress. */
export function DeadlineChip({ order }) {
  if (!isOpenOrder(order)) return null;
  const days = daysUntil(order.requiredBy);
  if (days < 0) return <StatusBadge tone="danger" label={`Overdue by ${-days} day${days === -1 ? '' : 's'}`} />;
  if (days === 0) return <StatusBadge tone="danger" label="Due today" />;
  if (days <= 7) return <StatusBadge tone="warning" label={`Due in ${days} day${days === 1 ? '' : 's'}`} />;
  return <StatusBadge tone="neutral" label={`In ${days} days`} />;
}

/**
 * Stepper driven by what the backend RECORDED (statusHistory), not by assumptions: a stage is
 * "done" only if the order passed through it.
 */
export function OrderProgress({ order, compact = false }) {
  const stopped = order.status === 'CANCELLED' || order.status === 'REJECTED';
  const completed = isCompletedOrder(order);
  const states = stepStates(order);

  return (
    <>
    <div className={`order-stepper ${compact ? 'compact' : ''}`} aria-label={`Order progress: ${STATUS_LABELS[order.status]}`}>
      {ORDER_STEPS.map((step, index) => {
        const state = states[index];
        const Icon = state === 'done' ? Check : state === 'current' ? CircleDot : state === 'stopped' ? XCircle : Circle;
        return (
          <div key={step.status} className={`order-step ${state} ${index === ORDER_STEPS.length - 1 ? 'last' : ''}`}>
            <span className="order-step-icon" aria-hidden="true">
              <Icon size={compact ? 12 : 14} />
            </span>
            {!compact && <span className="order-step-label">{step.label}</span>}
          </div>
        );
      })}
    </div>
    {completed && !compact && (
      <div className="order-stepper-done">
        <Check size={14} aria-hidden="true" /> Order completed: produced, dispatched, delivery verified and invoiced.
      </div>
    )}
    {stopped && !compact && (
      <div className="order-stepper-stop">
        <XCircle size={14} aria-hidden="true" /> {STATUS_LABELS[order.status]} — this order will not progress further.
      </div>
    )}
    </>
  );
}

/** Every recorded status change, newest last, with who/when/why. */
export function StatusHistory({ history }) {
  return (
    <ol className="status-history">
      {history.map((change, index) => (
        <li key={`${change.to}-${index}`} className="status-history-item">
          <span className="status-history-dot" aria-hidden="true">
            {change.to === 'CANCELLED' || change.to === 'REJECTED' ? <XCircle size={14} /> : <Clock size={14} />}
          </span>
          <div>
            <div className="status-history-title">
              {change.from ? `${STATUS_LABELS[change.from] ?? change.from} → ` : ''}
              <strong>{STATUS_LABELS[change.to] ?? change.to}</strong>
            </div>
            <div className="status-history-meta">
              {formatDateTime(change.at)} · by {change.byRole.replace('_', ' ').toLowerCase()}
            </div>
            {change.reason && <div className="status-history-reason">“{change.reason}”</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
