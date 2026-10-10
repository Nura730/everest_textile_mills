import { useState } from 'react';
import { fieldErrorsOf, newIdempotencyKey } from '../../api/client.js';
import { fulfilmentApi } from '../../api/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { formatDate, formatDateTime, formatNumber, formatPaise } from '../../utils/format.js';
import { DISPATCH_STATUS_LABELS } from '../../utils/machineStatus.js';
import { Field, Modal } from '../ui/Modal.jsx';
import { SignaturePad } from '../ui/SignaturePad.jsx';
import { EmptyState, ErrorState, LoadingState } from '../ui/States.jsx';
import { useToast } from '../ui/Toast.jsx';

const DISPATCH_TONES = { PREPARED: 'outline', CONFIRMED: 'active', CANCELLED: 'error' };

export function DispatchStatusBadge({ status }) {
  return <span className={`erp-status-badge ${DISPATCH_TONES[status] ?? 'neutral'}`}>{DISPATCH_STATUS_LABELS[status] ?? status}</span>;
}

/** Choose in-stock finished goods of one ready order and prepare a dispatch. */
export function PrepareDispatchModal({ order, onClose, onDone }) {
  const toast = useToast();
  const goods = useApiQuery(() => fulfilmentApi.finishedGoods({ orderId: order.id, status: 'IN_STOCK', limit: 100 }), [order.id]);
  const list = goods.data?.finishedGoods ?? [];
  const [chosen, setChosen] = useState(null); // Set of ids; null = all
  const selected = chosen ?? new Set(list.map((g) => g.id));
  const [vehicle, setVehicle] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const metres = list.filter((g) => selected.has(g.id)).reduce((sum, g) => sum + g.lengthMetres, 0);

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
    setError(null);
    setKey(newIdempotencyKey());
  };

  async function submit() {
    if (busy) return;
    if (selected.size === 0) return setError('Choose at least one roll.');
    if (vehicle.trim() && vehicle.trim().length < 4) return setError('Vehicle number looks too short.');
    setBusy(true);
    try {
      const { data } = await fulfilmentApi.prepare({ orderId: order.id, finishedGoodIds: [...selected], ...(vehicle.trim() ? { vehicleNumber: vehicle.trim() } : {}) }, key);
      toast.success(`Dispatch ${data.dispatch.dispatchNumber} prepared (${formatNumber(data.dispatch.totalMetres, 'm')}). Confirm it when it leaves.`);
      onDone();
    } catch (err) {
      const fields = fieldErrorsOf(err);
      setError(Object.values(fields)[0] ?? err.message);
      if (err.code === 'FINISHED_GOODS_UNAVAILABLE') {
        goods.reload();
        setChosen(null);
        setKey(newIdempotencyKey());
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Prepare dispatch for ${order.orderNumber}`}
      subtitle={`${order.buyer.name} · ordered ${formatNumber(order.quantityMetres, 'm')} of ${order.product.name}`}
      onClose={onClose}
      busy={busy}
      wide
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="erp-btn-primary" onClick={submit} disabled={busy || !goods.data}>{busy ? 'Preparing…' : `Prepare ${formatNumber(metres, 'm')}`}</button>
        </>
      }
    >
      {goods.error && <ErrorState error={goods.error} onRetry={goods.reload} />}
      {!goods.error && !goods.data && <LoadingState />}
      {goods.data && list.length === 0 && <EmptyState title="No finished goods in stock for this order" />}
      {list.length > 0 && (
        <>
          <p className="cell-sub">Only QC-passed rolls in stock can be dispatched. {metres < order.quantityMetres && `Selected ${formatNumber(metres, 'm')} is ${formatNumber(order.quantityMetres - metres, 'm')} short of the order.`}</p>
          <table className="erp-data-table">
            <thead><tr><th scope="col"><span className="sr-only">Select</span></th><th scope="col">Roll</th><th scope="col" className="num">Length</th><th scope="col">Location</th></tr></thead>
            <tbody>
              {list.map((g) => (
                <tr key={g.id}>
                  <td><input type="checkbox" aria-label={`Dispatch ${g.rollNumber}`} checked={selected.has(g.id)} onChange={() => toggle(g.id)} disabled={busy} /></td>
                  <td className="mono">{g.rollNumber}</td>
                  <td className="num">{formatNumber(g.lengthMetres, 'm')}</td>
                  <td>{g.location}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Field label="Vehicle number (optional)" htmlFor="dsp-vehicle">
            <input id="dsp-vehicle" className="erp-input" value={vehicle} maxLength={20} onChange={(e) => { setVehicle(e.target.value); setKey(newIdempotencyKey()); }} disabled={busy} placeholder="TN 39 AB 1234" />
          </Field>
        </>
      )}
      {error && <p className="login-field-error" role="alert">{error}</p>}
    </Modal>
  );
}

/** Final dispatch: the store keeper accepts the statement and signs (instruction.md §11). */
export function ConfirmDispatchModal({ dispatch, onClose, onDone }) {
  const toast = useToast();
  const [accepted, setAccepted] = useState(false);
  const [image, setImage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newIdempotencyKey);
  const statement = `I confirm that the finished goods in dispatch ${dispatch.dispatchNumber} have been dispatched.`;

  async function submit() {
    if (busy) return;
    if (!accepted || !image) return setError('Tick the statement and sign to confirm the dispatch.');
    setBusy(true);
    try {
      const { data } = await fulfilmentApi.confirm(dispatch.id, { signature: { accepted: true, image } }, key);
      toast.success(`Dispatch ${dispatch.dispatchNumber} confirmed and signed.${data.orderStatus === 'DISPATCHED' ? ' The order is fully dispatched.' : ''}`);
      onDone();
    } catch (err) {
      toast.error(err, { title: 'Dispatch not confirmed' });
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Confirm dispatch ${dispatch.dispatchNumber}`}
      subtitle={`${dispatch.orderNumber} · ${dispatch.rollCount} roll${dispatch.rollCount === 1 ? '' : 's'} · ${formatNumber(dispatch.totalMetres, 'm')}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="erp-btn-primary" onClick={submit} disabled={busy}>{busy ? 'Confirming…' : 'Sign and confirm'}</button>
        </>
      }
    >
      <p className="confirm-message">Rolls: {dispatch.lines.map((l) => l.rollNumber).join(', ')}</p>
      <div className="signature-block">
        <label className="filter-check" htmlFor="dsp-accept">
          <input id="dsp-accept" type="checkbox" checked={accepted} onChange={(e) => { setAccepted(e.target.checked); setError(null); }} disabled={busy} /> {statement}
        </label>
        <SignaturePad onChange={(value) => { setImage(value); setError(null); }} disabled={busy} label="Store keeper signature" />
      </div>
      {error && <p className="login-field-error" role="alert">{error}</p>}
    </Modal>
  );
}

/** A printable invoice. */
export function InvoiceView({ invoice, onClose }) {
  return (
    <Modal
      title={`Invoice ${invoice.invoiceNumber}`}
      subtitle={`Issued ${formatDate(invoice.issuedAt)} · dispatch ${invoice.dispatchNumber} · order ${invoice.orderNumber}`}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose}>Close</button>
          <button type="button" className="erp-btn-primary" onClick={() => window.print()}>Print</button>
        </>
      }
    >
      <div className="invoice-sheet">
        <div className="invoice-parties">
          <div><div className="detail-label">From</div><strong>Everest Textile Mills</strong></div>
          <div><div className="detail-label">Bill to</div><strong>{invoice.buyer.name}</strong> ({invoice.buyer.code}){invoice.buyer.address && <div className="cell-sub">{invoice.buyer.address}</div>}</div>
        </div>
        <table className="erp-data-table">
          <thead><tr><th scope="col">Description</th><th scope="col" className="num">Metres</th><th scope="col" className="num">Rate / m</th><th scope="col" className="num">Amount</th></tr></thead>
          <tbody>
            {invoice.lines.map((l, i) => (
              <tr key={i}><td>{l.description}</td><td className="num">{formatNumber(l.lengthMetres)}</td><td className="num">{formatPaise(l.pricePerMetrePaise)}</td><td className="num">{formatPaise(l.amountPaise)}</td></tr>
            ))}
          </tbody>
          <tfoot>
            <tr><th scope="row" colSpan={3}>Subtotal</th><td className="num">{formatPaise(invoice.subtotalPaise)}</td></tr>
            <tr><th scope="row" colSpan={3}>GST {invoice.taxRateBasisPoints / 100}%</th><td className="num">{formatPaise(invoice.taxPaise)}</td></tr>
            <tr><th scope="row" colSpan={3}>Total</th><td className="num"><strong>{formatPaise(invoice.totalPaise)}</strong></td></tr>
          </tfoot>
        </table>
        <p className="cell-sub">GST at {invoice.taxRateBasisPoints / 100}% is an assumption for woven fabric (HSN 5208–5407). Prices are the order's agreed price per metre.</p>
      </div>
    </Modal>
  );
}

/** Dispatches and invoices of one order (order detail). Buyers see their own; money only where allowed. */
export function OrderFulfilmentPanel({ order, showInvoices }) {
  const dispatches = useApiQuery(() => fulfilmentApi.dispatches({ orderId: order.id, limit: 50 }), [order.id, order.updatedAt]);
  const invoices = useApiQuery(() => (showInvoices ? fulfilmentApi.invoices({ orderId: order.id, limit: 50 }) : Promise.resolve({ data: { invoices: [] } })), [order.id, order.updatedAt, showInvoices]);
  const [viewing, setViewing] = useState(null);
  const list = dispatches.data?.dispatches ?? [];
  if (dispatches.data && list.length === 0) return null;
  return (
    <div className="erp-card section-gap">
      <h3 className="card-title">Dispatch{showInvoices ? ' and invoices' : ''}</h3>
      {!dispatches.data && <LoadingState />}
      {list.length > 0 && (
        <table className="erp-data-table">
          <thead><tr><th scope="col">Dispatch</th><th scope="col" className="num">Rolls</th><th scope="col" className="num">Metres</th><th scope="col">Status</th><th scope="col">Dispatched</th>{showInvoices && <th scope="col">Invoice</th>}</tr></thead>
          <tbody>
            {list.map((d) => {
              const invoice = (invoices.data?.invoices ?? []).find((i) => i.dispatchId === d.id);
              return (
                <tr key={d.id}>
                  <td className="mono">{d.dispatchNumber}</td>
                  <td className="num">{d.rollCount}</td>
                  <td className="num">{formatNumber(d.totalMetres, 'm')}</td>
                  <td><DispatchStatusBadge status={d.status} /></td>
                  <td>{d.confirmedAt ? formatDateTime(d.confirmedAt) : '—'}</td>
                  {showInvoices && <td>{invoice ? <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setViewing(invoice)}>{invoice.invoiceNumber} · {formatPaise(invoice.totalPaise)}</button> : '—'}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {viewing && <InvoiceView invoice={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
