import { useState } from 'react';
import { Link } from 'react-router-dom';
import { intelligenceApi } from '../api/endpoints.js';
import { RiskBadge, RiskDetail } from '../components/insights/RiskPanel.jsx';
import { OrderStatusBadge } from '../components/ui/OrderStatus.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { liveMatch, useLive } from '../realtime/realtimeBus.js';
import { formatDate, formatNumber } from '../utils/format.js';
import { estimateText } from '../utils/insights.js';

/**
 * Insights (Phase 17): every open order ranked by delivery risk, each with its reasons and what to
 * do; machines with repeated problems. Rules, not a black box: the assumptions are listed.
 */
export default function Insights() {
  const data = useApiQuery(() => intelligenceApi.overview(), []);
  useLive(liveMatch.actions('ORDER_', 'RUN_', 'ROLL_', 'QC_', 'MACHINE_', 'MATERIAL_', 'DISPATCH_'), data.reload, 1500);
  const [open, setOpen] = useState(null);
  const d = data.data;

  return (
    <div>
      <PageHeader
        title="Insights"
        subtitle="Which orders may miss their date, why, and what to do about it."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Insights' }]}
      />
      {data.error && <ErrorState error={data.error} onRetry={data.reload} />}
      {!d && !data.error && <LoadingState />}
      {d && (
        <>
          <div className="erp-tall-kpi-grid">
            {[['LATE', 'Late'], ['AT_RISK', 'At risk'], ['ON_TRACK', 'On track']].map(([key, label]) => (
              <div key={key} className="erp-tall-kpi-card">
                <div className="tall-kpi-header"><span className="tall-kpi-label">{label}</span></div>
                <div className={`tall-kpi-value ${key === 'LATE' && d.counts.LATE ? 'text-red' : ''}`}>{d.counts[key]}</div>
                <div className="tall-kpi-subtext">open orders</div>
              </div>
            ))}
          </div>
          <div className="erp-card section-gap">
            <div className="card-header"><h3 className="card-title">Orders by delivery risk</h3></div>
            {d.orders.length === 0 ? (
              <EmptyState title="No open orders" />
            ) : (
              <ul className="risk-list">
                {d.orders.map(({ order, risk }) => (
                  <li key={order.id} className={`risk-row level-${risk.level.toLowerCase()}`}>
                    <button type="button" className="risk-row-head" onClick={() => setOpen(open === order.id ? null : order.id)} aria-expanded={open === order.id}>
                      <RiskBadge level={risk.level} />
                      <span className="risk-order">
                        <strong>{order.orderNumber}</strong> · {order.buyerName} · {order.productName} · {formatNumber(order.quantityMetres, 'm')}
                        <span className="cell-sub"> · due {formatDate(order.requiredBy)}</span>
                      </span>
                      <OrderStatusBadge status={order.status} />
                    </button>
                    <div className="cell-sub risk-estimate">{estimateText(risk)}{risk.recommendations[0] && <> · <strong>{risk.recommendations[0].message}</strong></>}</div>
                    {open === order.id && (
                      <>
                        <RiskDetail risk={risk} />
                        <Link to={`/orders/${order.id}`} className="erp-btn-outline erp-btn-sm">Open order</Link>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="erp-card section-gap">
            <div className="card-header"><h3 className="card-title">Machines needing attention</h3></div>
            {d.machines.length === 0 ? (
              <p className="cell-sub">No machine had 3 or more problems in the last 30 days.</p>
            ) : (
              <ul className="plain-list">
                {d.machines.map((mc) => <li key={mc.machineId}><Link to={`/machines/${mc.machineId}`}>{mc.code}</Link>: {mc.recommendation}</li>)}
              </ul>
            )}
          </div>
          <details className="erp-card section-gap">
            <summary>How the estimate works</summary>
            <ul className="plain-list cell-sub">{d.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
          </details>
        </>
      )}
    </div>
  );
}
