import { useState } from 'react';
import { Link } from 'react-router-dom';
import { financeApi, fulfilmentApi } from '../api/endpoints.js';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { todayInIndia } from '../utils/attendance.js';
import { formatDate, formatNumber, formatPaise } from '../utils/format.js';

const RESULT = { PROFIT: ['success', 'Profit'], LOSS: ['danger', 'Loss'], BREAK_EVEN: ['neutral', 'Break-even'] };
const monthLabel = (month) => new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * The owner's month-end view (admin): did the mill make money this month (from recorded invoices,
 * yarn, wages and maintenance), cash in and out, production, the last six months, and who owes what.
 */
export default function Finance() {
  const [thisMonth] = useState(() => todayInIndia().slice(0, 7));
  const [month, setMonth] = useState(thisMonth);
  const statement = useApiQuery(() => financeApi.monthly(month), [month]);
  const trend = useApiQuery(() => financeApi.trend(6), []);
  const owed = useApiQuery(() => fulfilmentApi.receivables(), []);
  const s = statement.data;

  return (
    <div>
      <PageHeader
        title="Finance"
        subtitle="Month-end statement from recorded invoices, yarn, wages and maintenance. Nothing is estimated."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Finance' }]}
        actions={
          <label className="filter-check" htmlFor="fin-month">
            Month <input id="fin-month" type="month" className="erp-input" max={thisMonth} value={month} onChange={(e) => setMonth(e.target.value || thisMonth)} />
          </label>
        }
      />
      {statement.error && <div className="erp-card"><ErrorState error={statement.error} onRetry={statement.reload} /></div>}
      {!statement.error && !s && <div className="erp-card"><LoadingState /></div>}
      {s && (
        <>
          <div className="erp-card">
            <div className="card-header">
              <div>
                <h3 className="card-title">Did the mill make money in {monthLabel(s.month)}?</h3>
                <p className="card-subtitle">Operating result = sales − material used − stock write-offs − wages − maintenance</p>
              </div>
              <StatusBadge tone={RESULT[s.profit.made][0]} label={`${RESULT[s.profit.made][1]}: ${formatPaise(s.profit.operatingResultPaise)}${s.profit.marginPercent !== null ? ` (${s.profit.marginPercent}%)` : ''}`} />
            </div>
            <table className="erp-data-table">
              <tbody>
                <tr><th scope="row">Sales invoiced ({s.profit.invoices} invoice(s), excluding GST)</th><td className="num"><strong>{formatPaise(s.profit.salesPaise)}</strong></td></tr>
                <tr><th scope="row">Material used (yarn issued − returned, at purchase cost)</th><td className="num">− {formatPaise(s.profit.costs.materialUsedPaise)}</td></tr>
                <tr><th scope="row">Stock write-offs</th><td className="num">− {formatPaise(s.profit.costs.writeOffPaise)}</td></tr>
                <tr><th scope="row">Worker wages (attendance register)</th><td className="num">− {formatPaise(s.profit.costs.wagesPaise)}</td></tr>
                <tr><th scope="row">Machine maintenance</th><td className="num">− {formatPaise(s.profit.costs.maintenancePaise)}</td></tr>
              </tbody>
              <tfoot><tr><th scope="row">Operating result</th><td className="num"><strong>{formatPaise(s.profit.operatingResultPaise)}</strong></td></tr></tfoot>
            </table>
          </div>

          <div className="erp-card section-gap">
            <h3 className="card-title">Cash this month</h3>
            <p className="card-subtitle">Money in and out (not profit). Supplier payments are not tracked: yarn counts as paid when received.</p>
            <table className="erp-data-table">
              <tbody>
                <tr><th scope="row">Received from buyers ({s.cash.payments} payment(s))</th><td className="num">{formatPaise(s.cash.receivedFromBuyersPaise)}</td></tr>
                <tr><th scope="row">Yarn bought</th><td className="num">− {formatPaise(s.cash.yarnPurchasedPaise)}</td></tr>
                <tr><th scope="row">Wages</th><td className="num">− {formatPaise(s.cash.wagesPaise)}</td></tr>
                <tr><th scope="row">Maintenance</th><td className="num">− {formatPaise(s.cash.maintenancePaise)}</td></tr>
              </tbody>
              <tfoot><tr><th scope="row">Net cash</th><td className="num"><strong>{formatPaise(s.cash.netPaise)}</strong></td></tr></tfoot>
            </table>
          </div>

          <div className="erp-card section-gap">
            <h3 className="card-title">Production in {monthLabel(s.month)}</h3>
            <ul className="plain-list">
              <li>Produced {formatNumber(s.production.producedMetres, 'm')} in {s.production.rolls} roll(s); rejected {formatNumber(s.production.rejectedMetres, 'm')}</li>
              <li>Dispatched {formatNumber(s.production.dispatchedMetres, 'm')} in {s.production.dispatches} dispatch(es)</li>
              <li>Yarn used {formatNumber(s.production.yarnUsedKg, 'kg')} · bought {formatNumber(s.production.yarnPurchasedKg, 'kg')}</li>
              <li><Link to="/production-report">Output by machine and shift</Link></li>
            </ul>
            <ul className="plain-list section-gap cell-sub">{s.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </div>
        </>
      )}

      <div className="erp-card section-gap">
        <h3 className="card-title">Last six months</h3>
        {trend.error && <ErrorState error={trend.error} onRetry={trend.reload} />}
        {trend.data && (
          <table className="erp-data-table">
            <thead><tr><th scope="col">Month</th><th scope="col" className="num">Sales</th><th scope="col" className="num">Costs</th><th scope="col" className="num">Operating result</th><th scope="col" className="num">Received</th><th scope="col" className="num">Produced</th></tr></thead>
            <tbody>
              {trend.data.months.map((m) => (
                <tr key={m.month} className={m.month === month ? 'is-selected' : ''}>
                  <td><button type="button" className="link-button" onClick={() => setMonth(m.month)}>{monthLabel(m.month)}</button></td>
                  <td className="num">{formatPaise(m.salesPaise)}</td>
                  <td className="num">{formatPaise(m.costsPaise)}</td>
                  <td className={`num ${m.operatingResultPaise < 0 ? 'text-red' : ''}`}>{formatPaise(m.operatingResultPaise)}</td>
                  <td className="num">{formatPaise(m.receivedPaise)}</td>
                  <td className="num">{formatNumber(m.producedMetres, 'm')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="erp-card section-gap">
        <h3 className="card-title">Who owes money</h3>
        {owed.error && <ErrorState error={owed.error} onRetry={owed.reload} />}
        {owed.data && owed.data.invoices.length === 0 && <EmptyState title="Nothing is owed" />}
        {owed.data && owed.data.invoices.length > 0 && (
          <>
            <p className="card-subtitle">
              {formatPaise(owed.data.totals.outstandingPaise)} owed on {owed.data.totals.invoices} invoice(s) · not yet due {formatPaise(owed.data.totals.notDue)} · 1–30 days late {formatPaise(owed.data.totals.d1to30)} · 31–60 {formatPaise(owed.data.totals.d31to60)} · over 60 {formatPaise(owed.data.totals.over60)}
            </p>
            <table className="erp-data-table">
              <thead><tr><th scope="col">Buyer</th><th scope="col" className="num">Invoices</th><th scope="col" className="num">Not due</th><th scope="col" className="num">1–30 days late</th><th scope="col" className="num">31–60</th><th scope="col" className="num">Over 60</th><th scope="col" className="num">Total owed</th></tr></thead>
              <tbody>
                {owed.data.byBuyer.map((b) => (
                  <tr key={b.buyerId}><td>{b.buyerName}</td><td className="num">{b.invoices}</td><td className="num">{formatPaise(b.notDue)}</td><td className="num">{formatPaise(b.d1to30)}</td><td className="num">{formatPaise(b.d31to60)}</td><td className={`num ${b.over60 > 0 ? 'text-red' : ''}`}>{formatPaise(b.over60)}</td><td className="num"><strong>{formatPaise(b.outstandingPaise)}</strong></td></tr>
                ))}
              </tbody>
            </table>
            <table className="erp-data-table section-gap">
              <thead><tr><th scope="col">Invoice</th><th scope="col">Buyer</th><th scope="col">Due</th><th scope="col" className="num">Owed</th></tr></thead>
              <tbody>
                {owed.data.invoices.map((i) => (
                  <tr key={i.id}><td><Link to={`/invoices/${i.id}`}>{i.invoiceNumber}</Link></td><td>{i.buyerName}</td><td>{formatDate(i.dueDate)}{i.overdue && <span className="cell-sub text-red"> · {i.daysOverdue} day(s) late</span>}</td><td className="num">{formatPaise(i.outstandingPaise)}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
