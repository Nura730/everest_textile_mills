import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, PackagePlus, RefreshCw, Scale, ShieldAlert } from 'lucide-react';
import { fieldErrorsOf, newIdempotencyKey } from '../api/client.js';
import { inventoryApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { CachedNotice } from '../offline/CachedNotice.jsx';
import { PendingActions } from '../offline/PendingActions.jsx';
import { runOrQueue } from '../offline/syncManager.js';
import { useOnline } from '../offline/useQueue.js';
import { liveMatch, useLive } from '../realtime/realtimeBus.js';
import { can } from '../auth/roles.js';
import { FilterBar, FilterCheckbox, FilterDate, FilterSelect } from '../components/ui/Filters.jsx';
import { Field, Modal } from '../components/ui/Modal.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, ListLimitNotice, LoadingState } from '../components/ui/States.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useFilters } from '../hooks/useFilters.js';
import { formatDate, formatDateTime, formatNumber, formatPaise, rupeesToPaise } from '../utils/format.js';

const NO_STOCK_FILTERS = { material: '', colour: '', includeDepleted: false };
const MATERIALS = ['COTTON', 'POLYESTER', 'VISCOSE', 'NYLON', 'WOOL', 'SILK', 'LINEN', 'BLEND'];
const TX_LABELS = {
  RECEIPT: 'Received',
  ADJUSTMENT: 'Adjustment',
  RESERVATION: 'Reserved',
  RESERVATION_RELEASE: 'Released',
  ISSUE: 'Issued to production',
  RETURN: 'Returned',
};

function StockBar({ total, reserved }) {
  const pct = total > 0 ? Math.min(100, (reserved / total) * 100) : 0;
  return (
    <div className="stock-bar" title={`${formatNumber(reserved, 'kg')} reserved of ${formatNumber(total, 'kg')}`}>
      <div className="stock-bar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

function ReceiveModal({ onClose, onDone }) {
  const toast = useToast();
  const { user } = useAuth();
  const [form, setForm] = useState({ lotNumber: '', material: 'COTTON', colour: '', yarnCount: '', supplierName: '', quantityKg: '', costRupees: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setKey(newIdempotencyKey());
  };

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const qty = Number(form.quantityKg);
    const costPerKgPaise = rupeesToPaise(form.costRupees);
    const found = {};
    // Same limits as the server, so a receipt saved offline is not refused later for a typo.
    if (!/^[A-Za-z0-9][A-Za-z0-9/-]{2,39}$/.test(form.lotNumber.trim())) found.lotNumber = '3-40 characters: letters, digits, "/" or "-".';
    if (!/^[\p{L}][\p{L} -]{1,49}$/u.test(form.colour.trim())) found.colour = 'Letters, spaces and hyphens (2-50).';
    if (form.supplierName.trim().length < 2) found.supplierName = 'Enter the supplier (at least 2 characters).';
    if (!(qty > 0)) found.quantityKg = 'Enter the received quantity in kg.';
    else if (!/^\d+(\.\d{1,3})?$/.test(form.quantityKg.trim())) found.quantityKg = 'At most 3 decimal places.';
    if (costPerKgPaise === null) found.costPerKgPaise = 'Enter the cost per kg in rupees, at most 2 decimals (e.g. 320.50).';
    setErrors(found);
    if (Object.keys(found).length) return;

    const body = {
      lotNumber: form.lotNumber,
      material: form.material,
      colour: form.colour,
      supplierName: form.supplierName,
      quantityKg: qty,
      costPerKgPaise,
      ...(form.yarnCount.trim() ? { yarnCount: form.yarnCount.trim() } : {}),
    };
    setBusy(true);
    try {
      const sent = await runOrQueue(
        { key, type: 'MATERIAL_RECEIVE', payload: body, label: `Receipt ${body.lotNumber}: ${formatNumber(qty, 'kg')} ${body.material.toLowerCase()} ${body.colour}`, ref: { receipt: true }, userId: user.id },
        (k) => inventoryApi.receive(body, k),
      );
      if (sent.queued) {
        // Not in stock yet: stock only changes when the server records the lot.
        toast.info('Saved offline — waiting to sync. Stock is updated when the receipt reaches the server.', { title: 'Saved on this device' });
        onClose();
        return;
      }
      const { data, replayed } = sent.result;
      toast.success(replayed ? `Lot ${data.lot.lotNumber} was already received.` : `Stock updated: lot ${data.lot.lotNumber} received (${formatNumber(data.lot.totalKg, 'kg')}).`);
      onDone();
    } catch (error) {
      if (error.code === 'DUPLICATE_RESOURCE') setErrors({ lotNumber: 'This lot number has already been received.' });
      else {
        const fields = fieldErrorsOf(error);
        setErrors(fields);
        if (!Object.keys(fields).length) toast.error(error, { title: 'Yarn not received' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Receive yarn"
      subtitle="Creates a lot, its ledger entry and an audit record in one transaction."
      onClose={onClose}
      busy={busy}
      wide
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="receive-form" className="erp-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Receive lot'}</button>
        </>
      }
    >
      <form id="receive-form" className="erp-form-grid two-col" onSubmit={onSubmit} noValidate>
        <Field label="Lot / GRN number" htmlFor="r-lot" error={errors.lotNumber} required>
          <input id="r-lot" className="erp-input" value={form.lotNumber} onChange={update('lotNumber')} disabled={busy} placeholder="GRN-2026-0104" />
        </Field>
        <Field label="Supplier" htmlFor="r-supplier" error={errors.supplierName} required>
          <input id="r-supplier" className="erp-input" value={form.supplierName} onChange={update('supplierName')} disabled={busy} />
        </Field>
        <Field label="Material" htmlFor="r-material" error={errors.material} required>
          <select id="r-material" className="erp-input" value={form.material} onChange={update('material')} disabled={busy}>
            {MATERIALS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Colour" htmlFor="r-colour" error={errors.colour} required>
          <input id="r-colour" className="erp-input" value={form.colour} onChange={update('colour')} disabled={busy} placeholder="Navy" />
        </Field>
        <Field label="Quantity (kg)" htmlFor="r-qty" error={errors.quantityKg} hint="At most 3 decimals." required>
          <input id="r-qty" className="erp-input" inputMode="decimal" value={form.quantityKg} onChange={update('quantityKg')} disabled={busy} />
        </Field>
        <Field label="Cost per kg (₹)" htmlFor="r-cost" error={errors.costPerKgPaise} required>
          <input id="r-cost" className="erp-input" inputMode="decimal" value={form.costRupees} onChange={update('costRupees')} disabled={busy} placeholder="320.00" />
        </Field>
        <Field label="Yarn count (optional)" htmlFor="r-count" error={errors.yarnCount}>
          <input id="r-count" className="erp-input" value={form.yarnCount} onChange={update('yarnCount')} disabled={busy} placeholder="40s" />
        </Field>
      </form>
    </Modal>
  );
}

function AdjustModal({ lot, onClose, onDone }) {
  const toast = useToast();
  const [deltaKg, setDeltaKg] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const delta = Number(deltaKg);
    const found = {};
    if (!delta) found.deltaKg = 'Enter a non-zero change, e.g. -2.5 or 10.';
    if (reason.trim().length < 5) found.reason = 'Give a reason of at least 5 characters.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const { data } = await inventoryApi.adjust(lot.id, { deltaKg: delta, reason: reason.trim() }, key);
      toast.success(`Stock updated successfully: ${data.lot.lotNumber} is now ${formatNumber(data.lot.totalKg, 'kg')}.`);
      onDone();
    } catch (error) {
      if (error.code === 'INSUFFICIENT_STOCK') {
        setErrors({ deltaKg: `Unable to save: at most ${formatNumber(error.details.maxReductionKg, 'kg')} can be removed — ${formatNumber(error.details.reservedKg, 'kg')} is reserved for orders.` });
      } else {
        const fields = fieldErrorsOf(error);
        setErrors(fields);
        if (!Object.keys(fields).length) toast.error(error, { title: 'Stock not adjusted' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Adjust ${lot.lotNumber}`}
      subtitle={`Now ${formatNumber(lot.totalKg, 'kg')} in stock, ${formatNumber(lot.reservedKg, 'kg')} reserved. The ledger keeps both entries.`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="adjust-form" className="erp-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Record adjustment'}</button>
        </>
      }
    >
      <form id="adjust-form" className="erp-form-grid" onSubmit={onSubmit} noValidate>
        <Field label="Change (kg)" htmlFor="a-delta" error={errors.deltaKg} hint="Negative to write off, positive after a recount." required>
          <input id="a-delta" className="erp-input" inputMode="decimal" value={deltaKg} onChange={(event) => { setDeltaKg(event.target.value); setErrors({}); setKey(newIdempotencyKey()); }} disabled={busy} placeholder="-2.5" />
        </Field>
        <Field label="Reason" htmlFor="a-reason" error={errors.reason} required>
          <textarea id="a-reason" className="erp-input" rows={2} value={reason} onChange={(event) => { setReason(event.target.value); setErrors({}); setKey(newIdempotencyKey()); }} disabled={busy} placeholder="Water damage on two cones" />
        </Field>
      </form>
    </Modal>
  );
}

const NO_LEDGER_FILTERS = { type: '', from: '', to: '' };

function LedgerModal({ lot, onClose }) {
  const { filters, set, clear, query, active } = useFilters(NO_LEDGER_FILTERS);
  const ledger = useApiQuery(() => inventoryApi.lotTransactions(lot.id, { ...query, limit: 100 }), [lot.id, query]);
  return (
    <Modal title={`Ledger — ${lot.lotNumber}`} subtitle="Every movement of this lot, newest first. Entries are never edited." onClose={onClose} wide>
      <FilterBar active={active} onClear={clear} label="Ledger filters">
        <FilterSelect
          id="ledger-type"
          label="Movement"
          value={filters.type}
          onChange={(value) => set('type', value)}
          allLabel="All movements"
          options={Object.entries(TX_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <FilterDate id="ledger-from" label="From" value={filters.from} max={filters.to || undefined} onChange={(value) => set('from', value)} />
        <FilterDate id="ledger-to" label="To" value={filters.to} min={filters.from || undefined} onChange={(value) => set('to', value)} />
      </FilterBar>
      {ledger.error && <ErrorState error={ledger.error} onRetry={ledger.reload} />}
      {!ledger.error && !ledger.data && <LoadingState />}
      {ledger.data && ledger.data.transactions.length === 0 && (
        <EmptyState title={active ? 'No movements match these filters' : 'No movements'} />
      )}
      {ledger.data && ledger.data.transactions.length > 0 && (
        <table className="erp-data-table">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Movement</th>
              <th scope="col" className="num">Stock Δ</th>
              <th scope="col" className="num">Reserved Δ</th>
              <th scope="col">Order</th>
              <th scope="col">Reason</th>
            </tr>
          </thead>
          <tbody>
            {ledger.data.transactions.map((tx) => (
              <tr key={tx.id}>
                <td>{formatDateTime(tx.createdAt)}</td>
                <td>{TX_LABELS[tx.type] ?? tx.type}</td>
                <td className="num">{tx.deltaTotalKg > 0 ? '+' : ''}{formatNumber(tx.deltaTotalKg, 'kg')}</td>
                <td className="num">{tx.deltaReservedKg > 0 ? '+' : ''}{formatNumber(tx.deltaReservedKg, 'kg')}</td>
                <td>{tx.orderId ? <Link to={`/orders/${tx.orderId}`} onClick={onClose}>View order</Link> : '—'}</td>
                <td>{tx.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {ledger.data && <ListLimitNotice shown={ledger.data.transactions.length} total={ledger.meta?.total} />}
    </Modal>
  );
}

function Reconciliation() {
  const toast = useToast();
  const [state, setState] = useState({ busy: false, report: null });
  async function run() {
    setState({ busy: true, report: null });
    try {
      const { data } = await inventoryApi.reconciliation();
      setState({ busy: false, report: data });
      if (data.balanced) toast.success(`Stock verified: all ${data.lotsChecked} lots match their ledgers.`);
      else toast.warning(`${data.mismatches.length} lot(s) do not match their ledger. See details below.`);
    } catch (error) {
      setState({ busy: false, report: null });
      toast.error(error, { title: 'Reconciliation failed' });
    }
  }
  const report = state.report;
  return (
    <div className="erp-card section-gap">
      <div className="card-header">
        <div>
          <h3 className="card-title">Prove the numbers</h3>
          <p className="card-subtitle">Recomputes every lot's balance from its ledger and flags any difference.</p>
        </div>
        <button type="button" className="erp-btn-outline" onClick={run} disabled={state.busy}>
          <Scale size={15} aria-hidden="true" /> {state.busy ? 'Checking…' : 'Run reconciliation'}
        </button>
      </div>
      {report && report.balanced && (
        <p className="ok-line"><CheckCircle2 size={16} aria-hidden="true" /> Balanced — {report.lotsChecked} lots checked at {formatDateTime(report.checkedAt)}.</p>
      )}
      {report && !report.balanced && (
        <table className="erp-data-table">
          <thead><tr><th scope="col">Lot</th><th scope="col">Issues</th><th scope="col">Stored</th><th scope="col">Ledger says</th></tr></thead>
          <tbody>
            {report.mismatches.map((m) => (
              <tr key={m.lotId}>
                <td>{m.lotNumber ?? m.lotId}</td>
                <td><ShieldAlert size={14} aria-hidden="true" /> {m.issues.join(', ')}</td>
                <td>{m.stored ? `${formatNumber(m.stored.totalKg, 'kg')} / ${formatNumber(m.stored.reservedKg, 'kg')} reserved` : '—'}</td>
                <td>{formatNumber(m.ledger.totalKg, 'kg')} / {formatNumber(m.ledger.reservedKg, 'kg')} reserved</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Inventory() {
  const { user } = useAuth();
  const [tab, setTab] = useState('summary');
  const { filters, set, clear, query, active } = useFilters(NO_STOCK_FILTERS);
  const [modal, setModal] = useState(null); // { type: 'receive' | 'adjust' | 'ledger', lot }
  // The summary already groups by colour, so the colour filter applies to the lots list only.
  const summary = useApiQuery(
    () => inventoryApi.summary({ material: query.material, includeDepleted: query.includeDepleted }),
    [query.material, query.includeDepleted],
    { cacheKey: `stock-summary:${query.material ?? ''}:${query.includeDepleted ?? ''}` },
  );
  const online = useOnline();
  const lots = useApiQuery(() => inventoryApi.lots({ ...query, limit: 100 }), [query], { cacheKey: `lots:${JSON.stringify(query)}` });
  useLive(liveMatch.actions('MATERIAL_', 'STOCK_'), () => { lots.reload(); summary.reload(); });
  // Colour choices: the colours actually stocked for the chosen material.
  const colours = [...new Set((summary.data?.summary ?? []).map((row) => row.colour))].sort();
  const lotList = lots.data?.lots ?? [];
  const showsCost = lotList.some((lot) => lot.costPerKgPaise !== undefined);
  const refresh = () => {
    summary.reload();
    lots.reload();
  };

  return (
    <div>
      <PageHeader
        title="Yarn inventory"
        subtitle="Stock by lot. Available = in stock − reserved for orders. Every change is in the ledger."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Yarn inventory' }]}
        actions={
          <>
            <button type="button" className="erp-btn-outline" onClick={refresh} aria-label="Refresh stock">
              <RefreshCw size={15} className={summary.loading || lots.loading ? 'spin' : ''} aria-hidden="true" /> Refresh
            </button>
            {can.receiveYarn(user.role) && (
              <button type="button" className="erp-btn-primary" onClick={() => setModal({ type: 'receive' })}>
                <PackagePlus size={15} aria-hidden="true" /> Receive yarn
              </button>
            )}
          </>
        }
      />
      <CachedNotice cachedAt={lots.cachedAt ?? summary.cachedAt} />
      <PendingActions title="Receipts saved on this device" match={(item) => item.type === 'MATERIAL_RECEIVE'} onApplied={() => { lots.reload(); summary.reload(); }} />

      <div className="erp-card">
        <div className="toolbar">
          <div className="erp-tabs-bar" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'summary'} className={`erp-tab-btn ${tab === 'summary' ? 'active' : ''}`} onClick={() => setTab('summary')}>Stock by colour</button>
            <button type="button" role="tab" aria-selected={tab === 'lots'} className={`erp-tab-btn ${tab === 'lots' ? 'active' : ''}`} onClick={() => setTab('lots')}>Lots ({lots.meta?.total ?? '…'})</button>
          </div>
        </div>
        <FilterBar active={active} onClear={clear} label="Stock filters">
          <FilterSelect
            id="material-filter"
            label="Material"
            value={filters.material}
            onChange={(value) => {
              set('material', value);
              set('colour', ''); // a colour from another material would match nothing
            }}
            options={MATERIALS.map((m) => ({ value: m, label: m }))}
          />
          {tab === 'lots' && (
            <FilterSelect id="colour-filter" label="Colour" value={filters.colour} onChange={(value) => set('colour', value)} options={colours.map((c) => ({ value: c, label: c }))} />
          )}
          <FilterCheckbox id="depleted-filter" label="Include empty lots (0 kg)" checked={filters.includeDepleted} onChange={(value) => set('includeDepleted', value)} />
        </FilterBar>

        {tab === 'summary' && (
          <>
            {summary.error && <ErrorState error={summary.error} onRetry={summary.reload} />}
            {!summary.error && !summary.data && <LoadingState label="Loading stock…" />}
            {summary.data && summary.data.summary.length === 0 && (
              <EmptyState title="No yarn in stock">{can.receiveYarn(user.role) ? 'Receive the first lot to start tracking stock.' : 'The store has not received any yarn yet.'}</EmptyState>
            )}
            {summary.data?.summary.length > 0 && (
              <table className="erp-data-table">
                <thead>
                  <tr>
                    <th scope="col">Material · colour</th>
                    <th scope="col" className="num">Lots</th>
                    <th scope="col" className="num">In stock</th>
                    <th scope="col" className="num">Reserved</th>
                    <th scope="col" className="num">Available</th>
                    <th scope="col">Reserved share</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.data.summary.map((row) => (
                    <tr key={`${row.material}-${row.colour}`}>
                      <td className="table-primary-cell">{row.material} · {row.colour}</td>
                      <td className="num">{row.lots}</td>
                      <td className="num">{formatNumber(row.totalKg, 'kg')}</td>
                      <td className="num">{formatNumber(row.reservedKg, 'kg')}</td>
                      <td className="num"><strong>{formatNumber(row.availableKg, 'kg')}</strong></td>
                      <td><StockBar total={row.totalKg} reserved={row.reservedKg} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === 'lots' && (
          <>
            {lots.error && <ErrorState error={lots.error} onRetry={lots.reload} />}
            {!lots.error && !lots.data && <LoadingState label="Loading lots…" />}
            {lots.data && lotList.length === 0 && <EmptyState title="No lots" />}
            {lotList.length > 0 && (
              <div className="erp-table-wrapper">
                <table className="erp-data-table">
                  <thead>
                    <tr>
                      <th scope="col">Lot</th>
                      <th scope="col">Material · colour</th>
                      <th scope="col">Supplier</th>
                      <th scope="col">Received</th>
                      <th scope="col" className="num">In stock</th>
                      <th scope="col" className="num">Reserved</th>
                      <th scope="col" className="num">Available</th>
                      {showsCost && <th scope="col" className="num">Cost / kg</th>}
                      <th scope="col"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lotList.map((lot) => (
                      <tr key={lot.id}>
                        <td className="mono">{lot.lotNumber}</td>
                        <td>{lot.material} · {lot.colour}{lot.yarnCount && <div className="cell-sub">{lot.yarnCount}</div>}</td>
                        <td>{lot.supplierName}</td>
                        <td>{formatDate(lot.receivedAt)}</td>
                        <td className="num">{formatNumber(lot.totalKg, 'kg')}</td>
                        <td className="num">{formatNumber(lot.reservedKg, 'kg')}</td>
                        <td className="num"><strong>{formatNumber(lot.availableKg, 'kg')}</strong></td>
                        {showsCost && <td className="num">{formatPaise(lot.costPerKgPaise)}</td>}
                        <td className="row-actions">
                          <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setModal({ type: 'ledger', lot })}>Ledger</button>
                          {can.adjustStock(user.role) && (
                            <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setModal({ type: 'adjust', lot })} disabled={!online} title={online ? undefined : 'Needs a connection: an adjustment depends on the current balance.'}>Adjust</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <ListLimitNotice shown={lotList.length} total={lots.meta?.total} />
          </>
        )}
      </div>

      {can.reconcileStock(user.role) && <Reconciliation />}

      {modal?.type === 'receive' && <ReceiveModal onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal?.type === 'adjust' && <AdjustModal lot={modal.lot} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal?.type === 'ledger' && <LedgerModal lot={modal.lot} onClose={() => setModal(null)} />}
    </div>
  );
}
