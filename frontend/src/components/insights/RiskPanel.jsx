import { intelligenceApi } from '../../api/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { liveMatch, useLive } from '../../realtime/realtimeBus.js';
import { estimateText } from '../../utils/insights.js';
import { ErrorState, LoadingState } from '../ui/States.jsx';
import { StatusBadge } from '../ui/StatusBadge.jsx';

const LEVEL_LABELS = { LATE: 'Late', AT_RISK: 'At risk', ON_TRACK: 'On track' };

export function RiskBadge({ level }) {
  return <StatusBadge domain="RISK" state={level} label={LEVEL_LABELS[level] ?? level} />;
}

/** Factors and recommendations, both explained in words. */
export function RiskDetail({ risk }) {
  return (
    <div className="risk-detail">
      {risk.recommendations.length > 0 && (
        <>
          <div className="risk-heading">What to do</div>
          <ol className="plain-list">{risk.recommendations.map((r) => <li key={r.code + r.message}>{r.message}</li>)}</ol>
        </>
      )}
      <div className="risk-heading">Why</div>
      <ul className="plain-list cell-sub">{risk.factors.map((f) => <li key={f.code + f.message}>{f.message}</li>)}</ul>
    </div>
  );
}

/** Delivery risk of one order for the people who can act on it (Phase 17). */
export function OrderRiskPanel({ orderId, refreshKey }) {
  const data = useApiQuery(() => intelligenceApi.order(orderId), [orderId, refreshKey]);
  useLive(liveMatch.order(orderId), data.reload, 1000);
  if (data.error) return <div className="erp-card section-gap"><ErrorState error={data.error} onRetry={data.reload} /></div>;
  if (!data.data) return <div className="erp-card section-gap"><LoadingState /></div>;
  const { risk } = data.data;
  if (!risk) return null;
  return (
    <div className="erp-card section-gap">
      <div className="card-header">
        <div>
          <h3 className="card-title">Delivery outlook <RiskBadge level={risk.level} /></h3>
          <p className="card-subtitle">{estimateText(risk)}</p>
        </div>
      </div>
      <RiskDetail risk={risk} />
    </div>
  );
}
