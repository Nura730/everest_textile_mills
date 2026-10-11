import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { newIdempotencyKey } from '../api/client.js';
import { fulfilmentApi, ordersApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { liveMatch, useLive } from '../realtime/realtimeBus.js';
import { can } from '../auth/roles.js';
import { ConfirmDispatchModal, DeliveryBadge, DeliveryModal, DispatchStatusBadge, PrepareDispatchModal } from '../components/fulfilment/Fulfilment.jsx';
import { deliveryActionsFor } from '../utils/delivery.js';
import { DISPATCH_STATUS_LABELS } from '../utils/machineStatus.js';
import { FilterBar, FilterSelect, SearchInput } from '../components/ui/Filters.jsx';
import { ConfirmDialog } from '../components/ui/Modal.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { describeAvailability } from '../utils/dispatchAvailability.js';
import { EmptyState, ErrorState, ListLimitNotice, LoadingState } from '../components/ui/States.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useFilters } from '../hooks/useFilters.js';
import { formatDate, formatDateTime, formatNumber } from '../utils/format.js';

const FG_LABELS = { IN_STOCK: 'In stock', RESERVED_FOR_DISPATCH: 'Reserved for dispatch', DISPATCHED: 'Dispatched' };

/** Finished goods and dispatch: ready orders, dispatches (confirm signed, cancel, invoice) and stock. */
export default function DispatchPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [tab, setTab] = useState('ready');
  const ready = useApiQuery(() => ordersApi.list({ status: 'READY_FOR_DISPATCH', limit: 100 }), []);
  // Same rule as the Prepare window: what is actually dispatchable per ready order, and why not.
  const availability = useApiQuery(() => fulfilmentApi.availability(), []);
  const availabilityOf = (orderId) => describeAvailability(availability.data?.orders.find((a) => a.orderId === orderId));
  const dispatchFilters = useFilters({ status: '' });
  const dispatches = useApiQuery(() => fulfilmentApi.dispatches({ ...dispatchFilters.query, limit: 100 }), [dispatchFilters.query]);
  // Prepared dispatches holding this order's stock (full records, for the confirm / cancel actions).
  const preparedFor = (orderId) => {
    const ids = new Set((availability.data?.orders.find((a) => a.orderId === orderId)?.reserved.dispatches ?? []).map((d) => d.id));
    return (dispatches.data?.dispatches ?? []).filter((d) => ids.has(d.id) && d.status === 'PREPARED');
  };
  const stockFilters = useFilters({ q: '', status: 'IN_STOCK' });
  const stock = useApiQuery(() => fulfilmentApi.finishedGoods({ ...stockFilters.query, limit: 100 }), [stockFilters.query]);
  useLive(liveMatch.actions('FINISHED_GOOD_', 'DISPATCH_', 'ORDER_READY', 'ORDER_DISPATCHED', 'QC_PASSED', 'QC_REJECTED', 'RUN_COMPLETED'), () => { ready.reload(); availability.reload(); dispatches.reload(); stock.reload(); });
  const [modal, setModal] = useState(null); // { type, order | dispatch | good, key, busy, reason, text }
  const store = can.dispatchGoods(user.role);
  const reload = () => {
    ready.reload();
    availability.reload();
    dispatches.reload();
    stock.reload();
  };
  const done = () => {
    setModal(null);
    reload();
  };

  async function run(call, success) {
    setModal((m) => ({ ...m, busy: true }));
    try {
      const result = await call();
      toast.success(success(result));
      setModal(null);
      if (modal.type === 'invoice') navigate(`/invoices/${result.data.invoice.id}`);
    } catch (error) {
      toast.error(error, { title: 'Not saved' });
      setModal(null);
    }
    reload();
  }

  return (
    <div>
      <PageHeader
        title="Dispatch"
        subtitle="Finished goods are QC-passed rolls. Only goods in stock can be dispatched; the final handoff is cryptographically signed."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Dispatch' }]}
        actions={<button type="button" className="erp-btn-outline" onClick={reload} aria-label="Refresh"><RefreshCw size={15} aria-hidden="true" /> Refresh</button>}
      />
      <div className="erp-card">
        <div className="erp-tabs-bar" role="tablist">
          {[['ready', `Ready orders (${ready.data?.orders.length ?? '…'})`], ['dispatches', 'Dispatches'], ['stock', 'Finished goods']].map(([value, label]) => (
            <button key={value} type="button" role="tab" aria-selected={tab === value} className={`erp-tab-btn ${tab === value ? 'active' : ''}`} onClick={() => setTab(value)}>{label}</button>
          ))}
        </div>

        {tab === 'ready' && (
          <>
            {ready.error && <ErrorState error={ready.error} onRetry={ready.reload} />}
            {!ready.error && !ready.data && <LoadingState />}
            {ready.data && ready.data.orders.length === 0 && <EmptyState title="No orders ready for dispatch">An order is ready once production is complete, every roll is inspected and stock exists.</EmptyState>}
            {ready.data?.orders.length > 0 && (
              <table className="erp-data-table">
                <thead><tr><th scope="col">Order</th><th scope="col">Buyer</th><th scope="col">Fabric</th><th scope="col" className="num">Ordered</th><th scope="col">Dispatchable now</th><th scope="col">Required by</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {ready.data.orders.map((order) => (
                    <tr key={order.id}>
                      <td className="mono"><Link to={`/orders/${order.id}`}>{order.orderNumber}</Link></td>
                      <td>{order.buyer.name}</td>
                      <td>{order.product.name}</td>
                      <td className="num">{formatNumber(order.quantityMetres, 'm')}</td>
                      <td>
                        <StatusBadge tone={availabilityOf(order.id).canPrepare ? 'success' : 'warning'} label={availabilityOf(order.id).label} />
                        {availabilityOf(order.id).detail && <div className="cell-sub">{availabilityOf(order.id).detail}</div>}
                      </td>
                      <td>{formatDate(order.requiredBy)}</td>
                      <td className="row-actions">
                        {store && availabilityOf(order.id).canPrepare && (
                          <button type="button" className="erp-btn-primary erp-btn-sm" onClick={() => setModal({ type: 'prepare', order })}>
                            Prepare dispatch
                          </button>
                        )}
                        {/* Stock already in a prepared dispatch: the next step is to confirm or cancel THAT dispatch. */}
                        {store && preparedFor(order.id).map((d) => (
                          <span key={d.id} className="row-actions">
                            <button type="button" className="erp-btn-primary erp-btn-sm" onClick={() => setModal({ type: 'confirm', dispatch: d })}>Confirm {d.dispatchNumber}</button>
                            <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setModal({ type: 'cancel', dispatch: d, key: newIdempotencyKey(), reason: '' })}>Cancel</button>
                          </span>
                        ))}
                        {store && !availabilityOf(order.id).canPrepare && preparedFor(order.id).length === 0 && (
                          <button type="button" className="erp-btn-primary erp-btn-sm" disabled title={availabilityOf(order.id).detail ?? undefined}>Prepare dispatch</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === 'dispatches' && (
          <>
            <FilterBar active={dispatchFilters.active} onClear={dispatchFilters.clear} label="Dispatch filters">
              <FilterSelect id="dsp-status" label="Status" value={dispatchFilters.filters.status} onChange={(v) => dispatchFilters.set('status', v)} options={Object.entries(DISPATCH_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
            </FilterBar>
            {dispatches.data && dispatches.data.dispatches.length === 0 && <EmptyState title="No dispatches" />}
            {dispatches.data?.dispatches.length > 0 && (
              <table className="erp-data-table">
                <thead><tr><th scope="col">Dispatch</th><th scope="col">Order</th><th scope="col" className="num">Rolls</th><th scope="col" className="num">Metres</th><th scope="col">Vehicle</th><th scope="col">Status</th><th scope="col">Delivery</th><th scope="col">When</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {dispatches.data.dispatches.map((d) => (
                    <tr key={d.id}>
                      <td className="mono">{d.dispatchNumber}</td>
                      <td><Link to={`/orders/${d.orderId}`}>{d.orderNumber}</Link></td>
                      <td className="num">{d.rollCount}</td>
                      <td className="num">{formatNumber(d.totalMetres, 'm')}</td>
                      <td>{d.vehicleNumber ?? '—'}</td>
                      <td><DispatchStatusBadge status={d.status} />{d.signed && <span className="cell-sub"> · signed</span>}</td>
                      <td>
                        {d.delivery ? <DeliveryBadge delivery={d.delivery} /> : '—'}
                        {d.delivery?.discrepancy && <div className="cell-sub">Problem: {d.delivery.discrepancy.note}</div>}
                        {d.delivery?.status === 'IN_TRANSIT' && <div className="cell-sub">Waiting for the buyer to confirm receipt</div>}
                      </td>
                      <td>{formatDateTime(d.confirmedAt ?? d.createdAt)}</td>
                      <td className="row-actions">
                        {store && d.status === 'PREPARED' && <button type="button" className="erp-btn-primary erp-btn-sm" onClick={() => setModal({ type: 'confirm', dispatch: d })}>Confirm</button>}
                        {store && d.status === 'PREPARED' && <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setModal({ type: 'cancel', dispatch: d, key: newIdempotencyKey(), reason: '' })}>Cancel</button>}
                        {deliveryActionsFor(user.role, d).map((action) => (
                          <button key={action} type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setModal({ type: 'delivery', action, dispatch: d })}>{action === 'confirm' ? 'Confirm for buyer' : 'Verify delivery'}</button>
                        ))}
                        {can.issueInvoice(user.role) && d.status === 'CONFIRMED' && !d.invoiceId && d.delivery?.status === 'VERIFIED' && <button type="button" className="erp-btn-primary erp-btn-sm" onClick={() => setModal({ type: 'invoice', dispatch: d, key: newIdempotencyKey() })}>Issue invoice</button>}
                        {d.invoiceId && (can.issueInvoice(user.role) ? <Link className="erp-btn-outline erp-btn-sm" to={`/invoices/${d.invoiceId}`}>View invoice</Link> : <span className="cell-sub">Invoiced</span>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === 'stock' && (
          <>
            <FilterBar active={stockFilters.filters.q !== '' || stockFilters.filters.status !== 'IN_STOCK'} onClear={stockFilters.clear} label="Stock filters">
              <SearchInput id="fg-search" value={stockFilters.filters.q} onChange={(v) => stockFilters.set('q', v)} placeholder="Search roll, order, buyer or fabric" />
              <FilterSelect id="fg-status" label="Status" value={stockFilters.filters.status} onChange={(v) => stockFilters.set('status', v)} allLabel="All" options={Object.entries(FG_LABELS).map(([value, label]) => ({ value, label }))} />
            </FilterBar>
            {stock.data && stock.data.finishedGoods.length === 0 && <EmptyState title="No finished goods" />}
            {stock.data?.finishedGoods.length > 0 && (
              <table className="erp-data-table">
                <thead><tr><th scope="col">Roll</th><th scope="col">Order</th><th scope="col">Buyer</th><th scope="col">Fabric</th><th scope="col" className="num">Length</th><th scope="col">Location</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {stock.data.finishedGoods.map((g) => (
                    <tr key={g.id}>
                      <td className="mono"><Link to={`/rolls/${g.rollId}`}>{g.rollNumber}</Link></td>
                      <td>{g.orderNumber}</td>
                      <td>{g.buyerName}</td>
                      <td>{g.productName} <span className="cell-sub">{g.material} · {g.colour}</span></td>
                      <td className="num">{formatNumber(g.lengthMetres, 'm')}</td>
                      <td>{g.location}</td>
                      <td><StatusBadge domain="FINISHED_GOOD" state={g.status} label={FG_LABELS[g.status]} /></td>
                      <td className="row-actions">{store && g.status !== 'DISPATCHED' && <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setModal({ type: 'move', good: g, key: newIdempotencyKey(), text: g.location })}>Move</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <ListLimitNotice shown={stock.data?.finishedGoods.length ?? 0} total={stock.meta?.total} />
          </>
        )}
      </div>

      {modal?.type === 'prepare' && <PrepareDispatchModal order={modal.order} onClose={() => setModal(null)} onDone={() => { done(); setTab('dispatches'); }} />}
      {modal?.type === 'confirm' && <ConfirmDispatchModal dispatch={modal.dispatch} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'cancel' && (
        <ConfirmDialog
          title={`Cancel dispatch ${modal.dispatch.dispatchNumber}?`}
          message="The rolls go back into stock and can be dispatched again."
          confirmLabel="Cancel dispatch"
          danger
          busy={modal.busy}
          reason={modal.reason}
          reasonError={modal.error}
          onReasonChange={(reason) => setModal({ ...modal, reason, error: null })}
          onConfirm={() => (modal.reason.trim().length < 5 ? setModal({ ...modal, error: 'Give a reason of at least 5 characters.' }) : run(() => fulfilmentApi.cancel(modal.dispatch.id, modal.reason.trim(), modal.key), () => 'Dispatch cancelled; rolls back in stock.'))}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'invoice' && (
        <ConfirmDialog
          title={`Issue the invoice for ${modal.dispatch.dispatchNumber}?`}
          message="Priced at the order's agreed rate per metre, with GST. An issued invoice is never edited."
          confirmLabel="Issue invoice"
          busy={modal.busy}
          onConfirm={() => run(() => fulfilmentApi.invoice(modal.dispatch.id, modal.key), (r) => `Invoice ${r.data.invoice.invoiceNumber} issued.`)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'delivery' && <DeliveryModal dispatch={modal.dispatch} action={modal.action} onClose={() => setModal(null)} onDone={done} />}
      {modal?.type === 'move' && (
        <ConfirmDialog
          title={`Move ${modal.good.rollNumber}`}
          message="New storage location."
          confirmLabel="Move"
          busy={modal.busy}
          reason={modal.text}
          reasonError={modal.error}
          onReasonChange={(text) => setModal({ ...modal, text, error: null })}
          onConfirm={() => (!modal.text.trim() ? setModal({ ...modal, error: 'Enter a location.' }) : run(() => fulfilmentApi.moveGood(modal.good.id, modal.text.trim(), modal.key), () => 'Location updated.'))}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
