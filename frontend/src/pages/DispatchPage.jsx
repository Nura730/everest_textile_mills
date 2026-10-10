import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { newIdempotencyKey } from '../api/client.js';
import { fulfilmentApi, ordersApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { liveMatch, useLive } from '../realtime/realtimeBus.js';
import { can } from '../auth/roles.js';
import { ConfirmDispatchModal, DispatchStatusBadge, InvoiceView, PrepareDispatchModal } from '../components/fulfilment/Fulfilment.jsx';
import { DISPATCH_STATUS_LABELS } from '../utils/machineStatus.js';
import { FilterBar, FilterSelect, SearchInput } from '../components/ui/Filters.jsx';
import { ConfirmDialog } from '../components/ui/Modal.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
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
  const [tab, setTab] = useState('ready');
  const ready = useApiQuery(() => ordersApi.list({ status: 'READY_FOR_DISPATCH', limit: 100 }), []);
  const dispatchFilters = useFilters({ status: '' });
  const dispatches = useApiQuery(() => fulfilmentApi.dispatches({ ...dispatchFilters.query, limit: 100 }), [dispatchFilters.query]);
  const stockFilters = useFilters({ q: '', status: 'IN_STOCK' });
  const stock = useApiQuery(() => fulfilmentApi.finishedGoods({ ...stockFilters.query, limit: 100 }), [stockFilters.query]);
  useLive(liveMatch.actions('FINISHED_GOOD_', 'DISPATCH_', 'ORDER_READY', 'ORDER_DISPATCHED', 'QC_PASSED'), () => { ready.reload(); dispatches.reload(); stock.reload(); });
  const [modal, setModal] = useState(null); // { type, order | dispatch | good, key, busy, reason, text }
  const store = can.dispatchGoods(user.role);
  const reload = () => {
    ready.reload();
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
      if (modal.type === 'invoice') setModal({ type: 'view', invoice: result.data.invoice });
      else setModal(null);
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
        subtitle="Finished goods are QC-passed rolls. Only goods in stock can be dispatched; final dispatch is signed. Live data."
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
                <thead><tr><th scope="col">Order</th><th scope="col">Buyer</th><th scope="col">Fabric</th><th scope="col" className="num">Ordered</th><th scope="col">Required by</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {ready.data.orders.map((order) => (
                    <tr key={order.id}>
                      <td className="mono"><Link to={`/orders/${order.id}`}>{order.orderNumber}</Link></td>
                      <td>{order.buyer.name}</td>
                      <td>{order.product.name}</td>
                      <td className="num">{formatNumber(order.quantityMetres, 'm')}</td>
                      <td>{formatDate(order.requiredBy)}</td>
                      <td className="row-actions">{store && <button type="button" className="erp-btn-primary erp-btn-sm" onClick={() => setModal({ type: 'prepare', order })}>Prepare dispatch</button>}</td>
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
                <thead><tr><th scope="col">Dispatch</th><th scope="col">Order</th><th scope="col" className="num">Rolls</th><th scope="col" className="num">Metres</th><th scope="col">Vehicle</th><th scope="col">Status</th><th scope="col">When</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {dispatches.data.dispatches.map((d) => (
                    <tr key={d.id}>
                      <td className="mono">{d.dispatchNumber}</td>
                      <td><Link to={`/orders/${d.orderId}`}>{d.orderNumber}</Link></td>
                      <td className="num">{d.rollCount}</td>
                      <td className="num">{formatNumber(d.totalMetres, 'm')}</td>
                      <td>{d.vehicleNumber ?? '—'}</td>
                      <td><DispatchStatusBadge status={d.status} />{d.signed && <span className="cell-sub"> · signed</span>}</td>
                      <td>{formatDateTime(d.confirmedAt ?? d.createdAt)}</td>
                      <td className="row-actions">
                        {store && d.status === 'PREPARED' && <button type="button" className="erp-btn-primary erp-btn-sm" onClick={() => setModal({ type: 'confirm', dispatch: d })}>Confirm</button>}
                        {store && d.status === 'PREPARED' && <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setModal({ type: 'cancel', dispatch: d, key: newIdempotencyKey(), reason: '' })}>Cancel</button>}
                        {can.issueInvoice(user.role) && d.status === 'CONFIRMED' && !d.invoiceId && <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setModal({ type: 'invoice', dispatch: d, key: newIdempotencyKey() })}>Issue invoice</button>}
                        {d.invoiceId && <span className="cell-sub">Invoiced</span>}
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
                      <td><span className="erp-status-badge outline">{FG_LABELS[g.status]}</span></td>
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
      {modal?.type === 'view' && <InvoiceView invoice={modal.invoice} onClose={() => setModal(null)} />}
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
