import { useState } from 'react';
import { Link } from 'react-router-dom';
import { costingApi } from '../api/endpoints.js';
import { Profit } from '../components/costing/CostSheet.jsx';
import { Field, Modal } from '../components/ui/Modal.jsx';
import { OrderStatusBadge } from '../components/ui/OrderStatus.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { formatDate, formatNumber, formatPaise, rupeesToPaise } from '../utils/format.js';

const MACHINE_TYPES = ['SPINNING', 'WEAVING', 'DYEING', 'FINISHING'];
const rupees = (paise) => String(paise / 100);

function Kpi({ label, value, sub, alert }) {
  return (
    <div className="erp-tall-kpi-card">
      <div className="tall-kpi-header"><span className="tall-kpi-label">{label}</span></div>
      <div className={`tall-kpi-value ${alert ? 'text-red' : ''}`}>{value}</div>
      {sub && <div className="tall-kpi-subtext">{sub}</div>}
    </div>
  );
}

/** Edit the rate card: saving creates a new version; past costs keep the version they used. */
function RateCardModal({ current, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    labour: rupees(current.labourPaisePerHour),
    rework: rupees(current.reworkPaisePerRoll),
    overhead: String(current.overheadBasisPoints / 100),
    hours: String(current.workingHoursPerDay),
    note: '',
    ...Object.fromEntries(MACHINE_TYPES.map((t) => [t, rupees(current.machinePaisePerHour[t])])),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function save() {
    const money = ['labour', 'rework', ...MACHINE_TYPES].map((k) => rupeesToPaise(form[k]));
    const overhead = Number(form.overhead);
    const hours = Number(form.hours);
    if (money.some((v) => v === null)) return setError('Rates must be rupee amounts, e.g. 120 or 120.50.');
    if (!(overhead >= 0 && overhead <= 100) || !Number.isInteger(Math.round(overhead * 100))) return setError('Overhead must be a percentage between 0 and 100.');
    if (!Number.isInteger(hours) || hours < 1 || hours > 24) return setError('Working hours per day must be a whole number from 1 to 24.');
    setBusy(true);
    try {
      await costingApi.saveRates({
        labourPaisePerHour: money[0],
        reworkPaisePerRoll: money[1],
        machinePaisePerHour: Object.fromEntries(MACHINE_TYPES.map((t, i) => [t, money[2 + i]])),
        overheadBasisPoints: Math.round(overhead * 100),
        workingHoursPerDay: hours,
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      });
      toast.success('Rate card saved as a new version.');
      onSaved();
    } catch (err) {
      setBusy(false);
      setError(err.message);
    }
  }

  return (
    <Modal
      title="Edit rate card"
      subtitle="Saving creates a new version from now on. Orders that started earlier keep the rates they started with."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="erp-btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save new version'}</button>
        </>
      }
    >
      {error && <div className="form-notice-box delivery-warning" role="alert">{error}</div>}
      <div className="erp-form-grid two-col">
        <Field label="Labour (₹ per running hour)" htmlFor="rc-labour" required><input id="rc-labour" className="erp-input" inputMode="decimal" value={form.labour} onChange={set('labour')} /></Field>
        {MACHINE_TYPES.map((t) => (
          <Field key={t} label={`${t.charAt(0)}${t.slice(1).toLowerCase()} machine (₹/h)`} htmlFor={`rc-${t}`} required>
            <input id={`rc-${t}`} className="erp-input" inputMode="decimal" value={form[t]} onChange={set(t)} />
          </Field>
        ))}
        <Field label="Rework (₹ per round)" htmlFor="rc-rework" required><input id="rc-rework" className="erp-input" inputMode="decimal" value={form.rework} onChange={set('rework')} /></Field>
        <Field label="Overhead (% of direct cost)" htmlFor="rc-overhead" required><input id="rc-overhead" className="erp-input" inputMode="decimal" value={form.overhead} onChange={set('overhead')} /></Field>
        <Field label="Working hours per day" htmlFor="rc-hours" hint="Used to turn machine speed into delivery days" required><input id="rc-hours" className="erp-input" inputMode="numeric" value={form.hours} onChange={set('hours')} /></Field>
        <Field label="Note" htmlFor="rc-note"><input id="rc-note" className="erp-input" maxLength={500} value={form.note} onChange={set('note')} placeholder="e.g. New power tariff" /></Field>
      </div>
    </Modal>
  );
}

/** Owner's costing and profitability page (Phase 14). */
export default function Costing() {
  const summary = useApiQuery(() => costingApi.summary(), []);
  const overview = useApiQuery(() => costingApi.overview(), []);
  const [editing, setEditing] = useState(false);
  const s = summary.data;
  const o = overview.data;

  return (
    <div>
      <PageHeader
        title="Costing and profit"
        subtitle="Actual cost of every order in production or delivered, against invoiced or expected revenue."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Costing' }]}
        actions={s && <button type="button" className="erp-btn-outline" onClick={() => setEditing(true)}>Edit rate card</button>}
      />
      {(summary.error || overview.error) && <ErrorState error={summary.error ?? overview.error} onRetry={() => { summary.reload(); overview.reload(); }} />}
      {!s && !summary.error && <LoadingState />}
      {s && (
        <>
          <div className="erp-tall-kpi-grid">
            <Kpi label="Invoiced revenue" value={formatPaise(s.totals.invoicedRevenuePaise)} sub={o ? `${o.revenue.invoices} invoice(s), ex-GST` : null} />
            <Kpi label="Cost of invoiced orders" value={formatPaise(s.totals.invoicedCostPaise)} />
            <Kpi label="Profit on invoiced orders" value={formatPaise(s.totals.invoicedProfitPaise)} sub={s.totals.invoicedMarginPercent !== null ? `${s.totals.invoicedMarginPercent}% margin` : null} alert={s.totals.invoicedProfitPaise < 0} />
            <Kpi label="Orders in progress" value={formatPaise(s.totals.expectedRevenuePaise)} sub={`expected revenue · ${formatPaise(s.totals.costSoFarPaise)} spent so far`} />
          </div>
          {o && (
            <div className="erp-tall-kpi-grid">
              <Kpi label="Open orders" value={formatNumber(Object.entries(o.orders).filter(([k]) => !['INVOICED', 'CANCELLED', 'REJECTED'].includes(k)).reduce((a, [, n]) => a + n, 0))} />
              <Kpi label="Machines running" value={`${o.machines.RUNNING ?? 0} of ${Object.values(o.machines).reduce((a, b) => a + b, 0)}`} sub={o.machines.BREAKDOWN ? `${o.machines.BREAKDOWN} broken down` : null} alert={Boolean(o.machines.BREAKDOWN)} />
              <Kpi label="Yarn available" value={formatNumber(o.stock.availableKg, 'kg')} sub={`${formatNumber(o.stock.reservedKg, 'kg')} reserved`} />
              <Kpi label="Rolls awaiting QC" value={formatNumber((o.quality.rolls.QC_PENDING?.rolls ?? 0) + (o.quality.rolls.IN_REWORK?.rolls ?? 0))} />
            </div>
          )}
          {s.factoryExpenses && (
            <div className="erp-card section-gap">
              <div className="card-header">
                <div>
                  <h3 className="card-title">Factory expenses (not allocated to orders)</h3>
                  <p className="card-subtitle">Recorded where they happen; shown next to order profit, never spread over orders (no allocation rule is agreed).</p>
                </div>
              </div>
              <ul className="plain-list">
                <li>
                  Machine maintenance: <strong>{formatPaise(s.factoryExpenses.maintenance.totalPaise)}</strong> over {s.factoryExpenses.maintenance.jobs} maintenance job(s)
                  {s.factoryExpenses.maintenance.byMachine.length > 0 && ` — ${s.factoryExpenses.maintenance.byMachine.slice(0, 5).map((m) => `${m.code} ${formatPaise(m.totalPaise)}`).join(', ')}`}
                </li>
                {s.factoryExpenses.wages && <li>Worker wages (attendance register): <strong>{formatPaise(s.factoryExpenses.wages.totalPaise)}</strong> for {s.factoryExpenses.wages.periodLabel}</li>}
              </ul>
            </div>
          )}
          <div className="erp-card section-gap">
            <div className="card-header"><h3 className="card-title">Profit by order</h3></div>
            {s.orders.length === 0 ? (
              <EmptyState title="No orders in production yet" message="Costs appear once production starts." />
            ) : (
              <div className="erp-table-wrapper">
                <table className="erp-data-table">
                  <thead><tr><th scope="col">Order</th><th scope="col">Buyer</th><th scope="col">Status</th><th scope="col" className="num">Revenue</th><th scope="col" className="num">Cost</th><th scope="col" className="num">Profit</th></tr></thead>
                  <tbody>
                    {s.orders.map((r) => (
                      <tr key={r.id}>
                        <td><Link to={`/orders/${r.id}`}>{r.orderNumber}</Link><div className="cell-sub">{r.productName} · {formatNumber(r.quantityMetres, 'm')}</div></td>
                        <td>{r.buyerName}</td>
                        <td><OrderStatusBadge status={r.status} /></td>
                        <td className="num">{formatPaise(r.revenuePaise)}<div className="cell-sub">{r.revenueKind === 'INVOICED' ? 'invoiced' : 'expected'}</div></td>
                        <td className="num">{formatPaise(r.costPaise)}{!r.complete && <div className="cell-sub">so far</div>}</td>
                        <td className="num"><Profit paise={r.profitPaise} margin={r.marginPercent} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="erp-card section-gap">
            <div className="card-header">
              <div>
                <h3 className="card-title">Rate card {s.rateCard.isDefault ? '(defaults)' : `v${s.rateCard.version}`}</h3>
                <p className="card-subtitle">{s.rateCard.isDefault ? 'Default assumptions until you save your own rates.' : `In force since ${formatDate(s.rateCard.effectiveFrom)}${s.rateCard.note ? ` · ${s.rateCard.note}` : ''}`}</p>
              </div>
            </div>
            <ul className="plain-list">
              <li>Labour {formatPaise(s.rateCard.labourPaisePerHour)} per running hour</li>
              <li>Machines per hour: {MACHINE_TYPES.map((t) => `${t.toLowerCase()} ${formatPaise(s.rateCard.machinePaisePerHour[t])}`).join(', ')}</li>
              <li>Rework {formatPaise(s.rateCard.reworkPaisePerRoll)} per round · overhead {s.rateCard.overheadBasisPoints / 100}% · {s.rateCard.workingHoursPerDay} working hours per day</li>
            </ul>
            <details className="section-gap">
              <summary>How costs are calculated</summary>
              <ul className="plain-list cell-sub">{s.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            </details>
          </div>
        </>
      )}
      {editing && s && <RateCardModal current={s.rateCard} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); summary.reload(); }} />}
    </div>
  );
}
