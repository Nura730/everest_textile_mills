import { costingApi } from '../../api/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { formatNumber, formatPaise } from '../../utils/format.js';
import { ErrorState, LoadingState } from '../ui/States.jsx';

/** Profit colour: red for a loss, plain otherwise. */
export function Profit({ paise, margin }) {
  return (
    <span className={paise < 0 ? 'text-red' : ''}>
      {formatPaise(paise)}
      {margin !== null && margin !== undefined && <span className="cell-sub"> ({margin}%)</span>}
    </span>
  );
}

/**
 * The cost sheet of one order (owner only, Phase 14): where every rupee of cost comes from, against
 * invoiced or expected revenue, with the assumptions and rate-card version it used.
 */
export function OrderCostPanel({ orderId, refreshKey }) {
  const data = useApiQuery(() => costingApi.order(orderId), [orderId, refreshKey]);
  if (data.error) return <div className="erp-card section-gap"><ErrorState error={data.error} onRetry={data.reload} /></div>;
  if (!data.data) return <div className="erp-card section-gap"><LoadingState /></div>;
  const sheet = data.data;
  const lines = [
    ['Material (yarn issued)', sheet.cost.materialPaise],
    ['Labour', sheet.cost.labourPaise],
    ['Machine', sheet.cost.machinePaise],
    ['Rework', sheet.cost.reworkPaise],
    [`Overhead (${sheet.rateCard.overheadBasisPoints / 100}%)`, sheet.cost.overheadPaise],
  ];
  return (
    <div className="erp-card section-gap">
      <div className="card-header">
        <div>
          <h3 className="card-title">Cost and profit</h3>
          <p className="card-subtitle">
            {sheet.complete ? 'Final figures' : 'Figures so far; they change as production continues'} · rate card {sheet.rateCard.isDefault ? 'defaults' : `v${sheet.rateCard.version}`}
          </p>
        </div>
      </div>
      <div className="erp-table-wrapper">
        <table className="erp-data-table">
          <tbody>
            <tr><th scope="row">{sheet.revenue.kind === 'INVOICED' ? 'Revenue (invoiced, ex-GST)' : 'Revenue (expected order value)'}</th><td className="num">{formatPaise(sheet.revenue.amountPaise)}</td></tr>
            {lines.map(([label, paise]) => <tr key={label}><td>{label}</td><td className="num">{formatPaise(paise)}</td></tr>)}
            <tr><th scope="row">Total cost</th><td className="num"><strong>{formatPaise(sheet.cost.totalPaise)}</strong></td></tr>
            <tr><th scope="row">Profit</th><td className="num"><strong><Profit paise={sheet.profitPaise} margin={sheet.marginPercent} /></strong></td></tr>
            {sheet.costPerMetrePaise !== null && <tr><td>Cost per good metre</td><td className="num">{formatPaise(sheet.costPerMetrePaise)}</td></tr>}
            {sheet.waste.rejectedMetres > 0 && (
              <tr><td>Cost inside rejected rolls ({formatNumber(sheet.waste.rejectedMetres, 'm')} of {formatNumber(sheet.waste.producedMetres, 'm')})</td><td className="num">{formatPaise(sheet.waste.costInRejectedPaise)}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {(sheet.detail.material.length > 0 || sheet.detail.runs.length > 0) && (
        <details className="section-gap">
          <summary>Where the figures come from</summary>
          <ul className="plain-list">
            {sheet.detail.material.map((m) => <li key={m.lotNumber}>Lot {m.lotNumber}: {formatNumber(m.kg, 'kg')} × {formatPaise(m.costPerKgPaise)}/kg = {formatPaise(m.amountPaise)}</li>)}
            {sheet.detail.runs.map((r) => <li key={r.runNumber}>{r.runNumber} on {r.machineCode}: {r.hours} running hours → labour {formatPaise(r.labourPaise)}, machine {formatPaise(r.machinePaise)}</li>)}
            {sheet.detail.reworkRounds > 0 && <li>{sheet.detail.reworkRounds} rework round(s) × {formatPaise(sheet.rateCard.reworkPaisePerRoll)}</li>}
          </ul>
          <p className="cell-sub">Assumptions:</p>
          <ul className="plain-list cell-sub">{sheet.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
