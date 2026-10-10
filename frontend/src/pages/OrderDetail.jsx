import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Ban, CheckCircle2, Info, MinusCircle, PackageCheck, Pencil, ShieldCheck, XCircle, XOctagon } from 'lucide-react';
import { fieldErrorsOf, newIdempotencyKey } from '../api/client.js';
import { ordersApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ROLES, can } from '../auth/roles.js';
import { ConfirmDialog, Field, Modal } from '../components/ui/Modal.jsx';
import { ReservationPanel, ReserveModal } from '../components/orders/Reservation.jsx';
import { OrderRunsPanel } from '../components/production/OrderRuns.jsx';
import { OrderFulfilmentPanel } from '../components/fulfilment/Fulfilment.jsx';
import { DeadlineChip, OrderProgress, OrderStatusBadge, StatusHistory } from '../components/ui/OrderStatus.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { ErrorState, LoadingState } from '../components/ui/States.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { addDays, addYears, formatDate, formatDateTime, formatNumber, formatPaise, todayInIndia } from '../utils/format.js';

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

/**
 * Edit the buyer's own inputs while the order is still "Order created": quantity, required-by date
 * and notes. Fabric, company, price and number are fixed (shown, not editable). Yarn and order value
 * are recalculated by the server from the order's own price; a confirmed order cannot be edited.
 * One Idempotency-Key per attempt (a retry after a timeout cannot apply twice), and the order's
 * updatedAt so a save over someone else's change is refused.
 */
function EditOrderModal({ order, onClose, onSaved, onReload }) {
  const toast = useToast();
  const initial = { quantityMetres: String(order.quantityMetres), requiredBy: order.requiredBy, buyerNotes: order.buyerNotes ?? '' };
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
    setKey(newIdempotencyKey());
  };
  const minDate = addDays(todayInIndia(), 1);
  const maxDate = addYears(todayInIndia(), 2);

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const quantity = Number(form.quantityMetres);
    const found = {};
    if (!(quantity > 0)) found.quantityMetres = 'Enter a quantity greater than 0.';
    else if (!/^\d+(\.\d{1,2})?$/.test(form.quantityMetres.trim())) found.quantityMetres = 'Use at most 2 decimal places.';
    else if (quantity > 1_000_000) found.quantityMetres = 'At most 10,00,000 m per order.';
    if (!form.requiredBy) found.requiredBy = 'Choose the delivery date.';
    else if (form.requiredBy < minDate) found.requiredBy = 'The date must be after today.';
    else if (form.requiredBy > maxDate) found.requiredBy = 'The date must be within 2 years.';
    if (form.buyerNotes.length > 500) found.buyerNotes = 'At most 500 characters.';
    setErrors(found);
    if (Object.keys(found).length) return;

    const changes = {};
    if (quantity !== order.quantityMetres) changes.quantityMetres = quantity;
    if (form.requiredBy !== order.requiredBy) changes.requiredBy = form.requiredBy;
    const notes = form.buyerNotes.trim();
    if (notes !== (order.buyerNotes ?? '')) changes.buyerNotes = notes === '' ? null : notes;
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      const { data } = await ordersApi.update(order.id, { ...changes, expectedUpdatedAt: order.updatedAt }, key);
      toast.success(`Order ${data.order.orderNumber} updated.`);
      onSaved(data.order);
    } catch (error) {
      if (error.code === 'CONFLICT' || error.code === 'ORDER_NOT_EDITABLE') {
        // Someone else changed or confirmed it meanwhile: show the real order.
        toast.error(error, { title: error.code === 'CONFLICT' ? 'Changed by someone else' : 'Order can no longer be edited' });
        onReload();
      } else {
        const fields = fieldErrorsOf(error);
        setErrors(fields);
        if (!Object.keys(fields).length || fields.form) toast.error(error, { title: 'Order not updated' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Edit ${order.orderNumber}`}
      subtitle="Possible until the factory confirms the order. Yarn and value are recalculated by the server."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="edit-order-form" className="erp-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </>
      }
    >
      <form id="edit-order-form" className="erp-form-grid" onSubmit={onSubmit} noValidate>
        <div className="readonly-grid" aria-label="Fixed order details">
          <div><span>Fabric</span>{order.product.name}</div>
          <div><span>Buyer</span>{order.buyer.code}</div>
          {order.pricePerMetrePaise !== undefined && <div><span>Price (fixed)</span>{formatPaise(order.pricePerMetrePaise)} / m</div>}
        </div>
        <Field label="Quantity (metres)" htmlFor="eo-qty" error={errors.quantityMetres} hint="Up to 10,00,000 m, at most 2 decimals." required>
          <input id="eo-qty" className="erp-input" inputMode="decimal" value={form.quantityMetres} onChange={update('quantityMetres')} disabled={busy} />
        </Field>
        <Field label="Required by" htmlFor="eo-date" error={errors.requiredBy} hint="After today, within 2 years (India calendar)." required>
          <input id="eo-date" type="date" className="erp-input" min={minDate} max={maxDate} value={form.requiredBy} onChange={update('requiredBy')} disabled={busy} />
        </Field>
        <Field label="Notes for the factory" htmlFor="eo-notes" error={errors.buyerNotes} hint="Leave empty to remove the notes.">
          <textarea id="eo-notes" className="erp-input" rows={2} maxLength={500} value={form.buyerNotes} onChange={update('buyerNotes')} disabled={busy} />
        </Field>
      </form>
    </Modal>
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
  const [editing, setEditing] = useState(false);
  const [reserving, setReserving] = useState(false);

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
  const canCancel = ['ORDER_CREATED', 'CONFIRMED', 'MATERIAL_RESERVED'].includes(current.status) && can.cancelOrder(user.role);
  const canReserve = current.status === 'CONFIRMED' && can.reserveMaterial(user.role);
  const showsYarn = can.viewReservations(user.role) && ['MATERIAL_RESERVED', 'IN_PRODUCTION', 'PRODUCTION_COMPLETED', 'CANCELLED'].includes(current.status);
  const showsRuns = can.viewProduction(user.role) && ['MATERIAL_RESERVED', 'IN_PRODUCTION', 'PRODUCTION_COMPLETED', 'READY_FOR_DISPATCH', 'DISPATCHED', 'INVOICED'].includes(current.status);
  const canReject = isOpen && can.rejectOrder(user.role);
  const canConfirm = isOpen && can.confirmOrder(user.role);
  const canEdit = isOpen && can.editOrder(user.role);
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
            {canReserve && (
              <button type="button" className="erp-btn-primary" onClick={() => setReserving(true)}>
                <PackageCheck size={15} aria-hidden="true" /> Reserve yarn
              </button>
            )}
            {canEdit && (
              <button type="button" className="erp-btn-outline" onClick={() => setEditing(true)}>
                <Pencil size={15} aria-hidden="true" /> Edit
              </button>
            )}
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
              <strong>Next step: yarn reservation.</strong> The store reserves {current.requiredYarnKg !== undefined ? `${formatNumber(current.requiredYarnKg, 'kg')} of ` : ''}
              {current.product.material.toLowerCase()} · {current.product.colour} yarn for this order, so no other order can use it.
              {canCancel && ' A confirmed order can still be cancelled.'}
            </div>
          </div>
        )}
        {current.status === 'MATERIAL_RESERVED' && (
          <div className="next-step">
            <Info size={16} aria-hidden="true" />
            <div>
              <strong>Yarn reserved.</strong> The store issues it to the floor, then the floor plans a run on a machine
              and starts it once yarn is on the floor.
              {canCancel && ' Cancelling releases the yarn not yet issued and cancels planned runs.'}
            </div>
          </div>
        )}
        {current.status === 'IN_PRODUCTION' && (
          <div className="next-step">
            <Info size={16} aria-hidden="true" />
            <div>
              <strong>In production.</strong> Rolls are recorded as they come off the machine. Production is complete
              when no run is open and the rolls cover the ordered quantity. An order in production can no longer be cancelled.
            </div>
          </div>
        )}
        {current.status === 'PRODUCTION_COMPLETED' && (
          <div className="next-step">
            <Info size={16} aria-hidden="true" />
            <div>
              <strong>Production completed.</strong> QC inspects every roll; passed rolls become finished goods. The order is
              ready for dispatch once no roll is waiting for QC or rework.
            </div>
          </div>
        )}
        {current.status === 'READY_FOR_DISPATCH' && (
          <div className="next-step">
            <Info size={16} aria-hidden="true" />
            <div><strong>Ready for dispatch.</strong> The store prepares the dispatch from the finished rolls and confirms it with a signature.</div>
          </div>
        )}
        {current.status === 'DISPATCHED' && (
          <div className="next-step">
            <Info size={16} aria-hidden="true" />
            <div><strong>Dispatched.</strong> The invoice is issued next.</div>
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
      {['READY_FOR_DISPATCH', 'DISPATCHED', 'INVOICED'].includes(current.status) && (
        <OrderFulfilmentPanel order={current} showInvoices={user.role === ROLES.ADMIN || user.role === ROLES.BUYER} />
      )}
      {showsRuns && <OrderRunsPanel order={current} canPlan={can.runProduction(user.role)} onChanged={order.reload} />}
      {showsYarn && <ReservationPanel order={current} canMove={can.issueMaterial(user.role)} onChanged={order.reload} />}
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

      {reserving && (
        <ReserveModal
          order={current}
          onClose={() => setReserving(false)}
          onDone={() => {
            setReserving(false);
            order.reload();
          }}
        />
      )}
      {editing && (
        <EditOrderModal
          order={current}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            order.reload();
            feasibility.reload();
          }}
          onReload={() => {
            setEditing(false);
            order.reload();
          }}
        />
      )}
      {action && (
        <ConfirmDialog
          title={ACTIONS[action.name].title}
          message={
            action.name === 'confirm'
              ? `Order ${current.orderNumber} will be confirmed. The server runs the feasibility check again and records the result; the buyer will see the order as confirmed.`
              : action.name === 'cancel'
                ? `Order ${current.orderNumber} (${formatNumber(current.quantityMetres, 'm')} of ${current.product.name}) will be cancelled. This cannot be undone.${current.status === 'MATERIAL_RESERVED' ? ' Yarn reserved and not yet issued goes back to available stock; yarn already on the floor can be returned afterwards.' : ''}`
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
