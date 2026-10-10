import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Ban, Info, XOctagon } from 'lucide-react';
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
  cancel: {
    title: 'Cancel this order?',
    confirmLabel: 'Cancel order',
    success: (order) => `Order ${order.orderNumber} cancelled successfully.`,
    call: ordersApi.cancel,
  },
  reject: {
    title: 'Reject this order?',
    confirmLabel: 'Reject order',
    success: (order) => `Order ${order.orderNumber} rejected.`,
    call: ordersApi.reject,
  },
};

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
  const canCancel = isOpen && can.cancelOrder(user.role);
  const canReject = isOpen && can.rejectOrder(user.role);

  async function confirmAction() {
    const reason = action.reason.trim();
    if (reason.length < 5) {
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
              <strong>Next step: confirmation.</strong> The factory confirms an order after a feasibility check
              (yarn, machines, deadline). That check is the next backend phase, so this order stays in
              “Order created” until it is built. {canCancel && 'It can still be cancelled.'}
            </div>
          </div>
        )}
      </div>

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
            action.name === 'cancel'
              ? `Order ${current.orderNumber} (${formatNumber(current.quantityMetres, 'm')} of ${current.product.name}) will be cancelled. This cannot be undone.`
              : `Order ${current.orderNumber} will be rejected and the buyer will see your reason. This cannot be undone.`
          }
          confirmLabel={ACTIONS[action.name].confirmLabel}
          danger
          busy={action.busy}
          reason={action.reason}
          reasonError={action.error}
          onReasonChange={(reason) => setAction({ ...action, reason, error: null })}
          onConfirm={confirmAction}
          onClose={() => setAction(null)}
        />
      )}
    </div>
  );
}
