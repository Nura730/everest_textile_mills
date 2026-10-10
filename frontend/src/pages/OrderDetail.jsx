import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Ban, CheckCircle2, Info, MinusCircle, ShieldCheck, XCircle, XOctagon } from 'lucide-react';
import { newIdempotencyKey } from '../api/client.js';
import { ordersApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ROLES, can } from '../auth/roles.js';
import { ConfirmDialog } from '../components/ui/Modal.jsx';
import { DeadlineChip, OrderProgress, OrderStatusBadge, StatusHistory } from '../components/ui/OrderStatus.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { ErrorState, LoadingState } from '../components/ui/States.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { formatDate, formatDateTime, formatNumber, formatPaise } from '../utils/format.js';

const ACTIONS = {
  confirm: {
    title: 'Confirm this order?',
    confirmLabel: 'Confirm order',
    needsReason: false,
    success: (order) => `Order ${order.orderNumber} confirmed.`,
    call: (id, _reason, key) => ordersApi.confirm(id, key),
  },
  cancel: {
    title: 'Cancel this order?',
    confirmLabel: 'Cancel order',
    needsReason: true,
    danger: true,
    success: (order) => `Order ${order.orderNumber} cancelled successfully.`,
    call: ordersApi.cancel,
  },
  reject: {
    title: 'Reject this order?',
    confirmLabel: 'Reject order',
    needsReason: true,
    danger: true,
    success: (order) => `Order ${order.orderNumber} rejected.`,
    call: ordersApi.reject,
  },
};

const CHECK_ICONS = { PASS: CheckCircle2, FAIL: XCircle, NOT_ASSESSED: MinusCircle };

function Metric({ label, children }) {
  return (
    <div className="feasibility-metric-box">
      <span className="feasibility-metric-label">{label}</span>
      <span className="feasibility-metric-value">{children}</span>
    </div>
  );
}

/** A feasibility result from the backend: the verdict, the numbers behind it, and every check. */
function FeasibilityResult({ feasibility, caption }) {
  const ok = feasibility.status === 'FEASIBLE';
  const { inputs } = feasibility;
  return (
    <div className={`feasibility-result-panel ${ok ? 'feasible' : 'not-feasible'}`}>
      <div className="feasibility-verdict-row">
        <div className="feasibility-badge-wrap">
          {ok ? (
            <CheckCircle2 size={18} className="feasibility-icon-success" aria-hidden="true" />
          ) : (
            <XCircle size={18} className="feasibility-icon-error" aria-hidden="true" />
          )}
          <strong className={`feasibility-verdict-text ${ok ? '' : 'error'}`}>{ok ? 'Feasible' : 'Not feasible'}</strong>
        </div>
        <span className="cell-sub">
          {caption} · {formatDateTime(feasibility.computedAt)}
        </span>
      </div>
      <div className="feasibility-metrics-summary">
        <Metric label="Yarn needed">{formatNumber(inputs.requiredYarnKg, 'kg')}</Metric>
        <Metric label="Free yarn">{formatNumber(inputs.freeKg, 'kg')}</Metric>
        <Metric label="Promised to other orders">{formatNumber(inputs.committedKg, 'kg')}</Metric>
        <Metric label="Days to deadline">{inputs.daysToDeadline}</Metric>
      </div>
      <ul className="feasibility-reasons-list">
        {feasibility.checks.map((check) => {
          const Icon = CHECK_ICONS[check.result] ?? MinusCircle;
          return (
            <li key={check.code} className={`feasibility-check ${check.result.toLowerCase()}`}>
              <Icon size={14} aria-hidden="true" /> <span>{check.message}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Detail({ label, children }) {
  return (
    <div className="detail-item">
      <div className="detail-label">{label}</div>
      <div className="detail-value">{children}</div>
    </div>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const order = useApiQuery(() => ordersApi.get(id), [id]);
  // Live feasibility only while the order awaits a decision, and only for planning roles (it shows
  // stock levels). Once confirmed, the snapshot stored on the order is shown instead.
  const checkLive = order.data?.order.status === 'ORDER_CREATED' && can.viewFeasibility(user.role);
  const feasibility = useApiQuery(
    () => (checkLive ? ordersApi.feasibility(id) : Promise.resolve({ data: null })),
    [id, checkLive],
  );
  const [action, setAction] = useState(null); // { name, reason, key, busy, error }

  if (order.error) {
    return (
      <div>
        <PageHeader title="Order" breadcrumbs={[{ label: 'Orders', to: '/orders' }, { label: 'Not available' }]} />
        {/* A buyer opening another company's order gets the same 404 as a missing order. */}
        <ErrorState error={order.error} onRetry={order.error.status === 404 ? undefined : order.reload} />
      </div>
    );
  }
  if (!order.data) return <LoadingState label="Loading order…" />;

  const current = order.data.order;
  const isOpen = current.status === 'ORDER_CREATED';
  const canCancel = (isOpen || current.status === 'CONFIRMED') && can.cancelOrder(user.role);
  const canReject = isOpen && can.rejectOrder(user.role);
  const canConfirm = isOpen && can.confirmOrder(user.role);
  const liveResult = feasibility.data?.feasibility ?? null;
  // The backend re-checks on confirm; this only avoids offering a button that would be refused.
  const confirmBlocked = liveResult?.status === 'NOT_FEASIBLE';

  async function confirmAction() {
    const reason = action.reason.trim();
    if (ACTIONS[action.name].needsReason && reason.length < 5) {
      setAction({ ...action, error: 'Give a reason of at least 5 characters.' });
      return;
    }
    setAction({ ...action, busy: true, error: null });
    try {
      await ACTIONS[action.name].call(current.id, reason, action.key);
      toast.success(ACTIONS[action.name].success(current));
      setAction(null);
      order.reload();
    } catch (error) {
      if (error.code === 'INVALID_STATE_TRANSITION') {
        // Someone else changed the order meanwhile: show the real state.
        toast.error(error, { title: 'Order already changed' });
        setAction(null);
        order.reload();
      } else if (error.code === 'ORDER_NOT_FEASIBLE') {
        // Stock or other confirmations changed since the check was shown: show the new reasons.
        toast.error(error, { title: 'Not feasible' });
        setAction(null);
        feasibility.reload();
      } else {
        toast.error(error);
        setAction({ ...action, busy: false });
      }
    }
  }

  return (
    <div>
      <PageHeader
        title={current.orderNumber}
        subtitle={`${current.product.name} for ${current.buyer.name}`}
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: user.role === ROLES.BUYER ? 'My orders' : 'Orders', to: '/orders' }, { label: current.orderNumber }]}
        actions={
          <>
            {canConfirm && (
              <button
                type="button"
                className="erp-btn-primary"
                disabled={confirmBlocked || feasibility.loading}
                title={confirmBlocked ? 'The feasibility check fails: see the reasons below.' : undefined}
                onClick={() => setAction({ name: 'confirm', reason: '', key: newIdempotencyKey() })}
              >
                <ShieldCheck size={15} aria-hidden="true" /> Confirm
              </button>
            )}
            {canReject && (
              <button type="button" className="erp-btn-outline" onClick={() => setAction({ name: 'reject', reason: '', key: newIdempotencyKey() })}>
                <XOctagon size={15} aria-hidden="true" /> Reject
              </button>
            )}
            {canCancel && (
              <button type="button" className="erp-btn-danger" onClick={() => setAction({ name: 'cancel', reason: '', key: newIdempotencyKey() })}>
                <Ban size={15} aria-hidden="true" /> Cancel order
              </button>
            )}
          </>
        }
      />

      <div className="erp-card section-gap">
        <div className="card-header">
          <div>
            <h3 className="card-title">Progress</h3>
            <p className="card-subtitle">Stages are marked done only when the backend has recorded them.</p>
          </div>
          <OrderStatusBadge status={current.status} />
        </div>
        <OrderProgress order={current} />
        {isOpen && (
          <div className="next-step">
            <Info size={16} aria-hidden="true" />
            <div>
              <strong>Next step: confirmation.</strong> The factory confirms an order once a feasibility check
              passes: enough free yarn of this material and colour, and time left before the deadline.
              {canCancel && ' It can still be cancelled.'}
            </div>
          </div>
        )}
        {current.status === 'CONFIRMED' && (
          <div className="next-step">
            <Info size={16} aria-hidden="true" />
            <div>
              <strong>Next step: yarn reservation.</strong> Reserving yarn for confirmed orders is the next
              backend phase. {canCancel && 'A confirmed order can still be cancelled.'}
            </div>
          </div>
        )}
      </div>

      {checkLive && (
        <div className="erp-card section-gap">
          <h3 className="card-title">Feasibility</h3>
          <p className="card-subtitle">Checked live against current stock and other confirmed orders. Machine capacity is not assessed yet.</p>
          {feasibility.error ? (
            <ErrorState error={feasibility.error} onRetry={feasibility.reload} />
          ) : liveResult ? (
            <FeasibilityResult feasibility={liveResult} caption="Live check" />
          ) : (
            <LoadingState label="Checking feasibility…" />
          )}
        </div>
      )}
      {current.feasibility && (
        <div className="erp-card section-gap">
          <h3 className="card-title">Feasibility at confirmation</h3>
          <p className="card-subtitle">The check this order was confirmed on, as recorded by the server.</p>
          <FeasibilityResult feasibility={current.feasibility} caption="Recorded" />
        </div>
      )}

      <div className="detail-columns">
        <div className="erp-card">
          <h3 className="card-title">Order details</h3>
          <div className="detail-grid">
            <Detail label="Buyer">{current.buyer.name} <span className="cell-sub">({current.buyer.code})</span></Detail>
            <Detail label="Fabric">{current.product.name} <span className="cell-sub">({current.product.code})</span></Detail>
            <Detail label="Material / colour">{current.product.material} · {current.product.colour}</Detail>
            <Detail label="Quantity">{formatNumber(current.quantityMetres, 'm')}</Detail>
            <Detail label="Required by">
              {formatDate(current.requiredBy)} <DeadlineChip order={current} />
            </Detail>
            {current.pricePerMetrePaise !== undefined && <Detail label="Price">{formatPaise(current.pricePerMetrePaise)} / m</Detail>}
            {current.orderValuePaise !== undefined && <Detail label="Order value">{formatPaise(current.orderValuePaise)}</Detail>}
            {current.requiredYarnKg !== undefined && (
              <Detail label="Yarn required">{formatNumber(current.requiredYarnKg, 'kg')} {current.product.material.toLowerCase()} · {current.product.colour}</Detail>
            )}
            <Detail label="Placed">{formatDateTime(current.createdAt)}</Detail>
            <Detail label="Notes">{current.buyerNotes ?? '—'}</Detail>
          </div>
        </div>

        <div className="erp-card">
          <h3 className="card-title">Status history</h3>
          <p className="card-subtitle">Recorded by the server; the full audit trail is kept separately.</p>
          <StatusHistory history={current.statusHistory} />
        </div>
      </div>

      {action && (
        <ConfirmDialog
          title={ACTIONS[action.name].title}
          message={
            action.name === 'confirm'
              ? `Order ${current.orderNumber} will be confirmed. The server runs the feasibility check again and records the result; the buyer will see the order as confirmed.`
              : action.name === 'cancel'
                ? `Order ${current.orderNumber} (${formatNumber(current.quantityMetres, 'm')} of ${current.product.name}) will be cancelled. This cannot be undone.`
                : `Order ${current.orderNumber} will be rejected and the buyer will see your reason. This cannot be undone.`
          }
          confirmLabel={ACTIONS[action.name].confirmLabel}
          danger={ACTIONS[action.name].danger}
          busy={action.busy}
          reason={action.reason}
          reasonError={action.error}
          onReasonChange={ACTIONS[action.name].needsReason ? (reason) => setAction({ ...action, reason, error: null }) : undefined}
          onConfirm={confirmAction}
          onClose={() => setAction(null)}
        />
      )}
    </div>
  );
}
