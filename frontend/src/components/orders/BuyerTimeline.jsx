import { Check, Circle, CircleDot } from 'lucide-react';
import { ordersApi } from '../../api/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { formatDate, formatNumber } from '../../utils/format.js';
import { DeliveryBadge } from '../fulfilment/Fulfilment.jsx';
import { ErrorState, LoadingState } from '../ui/States.jsx';

const DELIVERY_TEXT = {
  ON_TRACK: 'On track for the required date.',
  AT_RISK: 'At risk of missing the required date.',
  LATE: 'Expected after the required date.',
};

/**
 * The buyer's view of an order (instruction.md §19): a simple timeline with production and QC progress
 * and the expected delivery. No machines, lots, costs or people.
 */
export function BuyerTimeline({ order }) {
  const data = useApiQuery(() => ordersApi.timeline(order.id), [order.id, order.updatedAt]);
  if (data.error) return <div className="erp-card section-gap"><ErrorState error={data.error} onRetry={data.reload} /></div>;
  if (!data.data) return <div className="erp-card section-gap"><LoadingState /></div>;
  const { timeline } = data.data;
  const { progress, expectedDelivery } = timeline;
  return (
    <div className="erp-card section-gap">
      <div className="card-header">
        <div>
          <h3 className="card-title">Order timeline</h3>
          <p className="card-subtitle">
            {formatNumber(progress.producedMetres, 'm')} of {formatNumber(progress.orderedMetres, 'm')} produced ({progress.producedPercent}%)
            {progress.dispatchedMetres > 0 && ` · ${formatNumber(progress.dispatchedMetres, 'm')} dispatched`}
          </p>
        </div>
      </div>
      <div className="stock-bar" aria-label={`${progress.producedPercent}% produced`}><div className="stock-bar-fill" style={{ width: `${progress.producedPercent}%` }} /></div>
      <ol className="buyer-stage-list">
        {timeline.stages.map((stage) => {
          const Icon = stage.state === 'done' ? Check : stage.state === 'current' ? CircleDot : Circle;
          return (
            <li key={stage.key} className={`buyer-stage ${stage.state}`}>
              <Icon size={16} aria-hidden="true" />
              <div>
                <div className="buyer-stage-label">{stage.label}{stage.state === 'current' && <span className="cell-sub"> · current</span>}</div>
                {(stage.detail || stage.at) && <div className="cell-sub">{[stage.detail, stage.at && formatDate(stage.at)].filter(Boolean).join(' · ')}</div>}
              </div>
            </li>
          );
        })}
      </ol>
      {timeline.deliveries?.length > 0 && (
        <ul className="plain-list section-gap" aria-label="Deliveries">
          {timeline.deliveries.map((d) => (
            <li key={d.id}>
              <strong>{d.dispatchNumber}</strong> · {formatNumber(d.metres, 'm')} dispatched {formatDate(d.dispatchedAt)} · <DeliveryBadge delivery={d} />
              {d.status === 'IN_TRANSIT' && <span className="cell-sub"> Confirm receipt (or report a problem) in Dispatch below.</span>}
              {d.invoiced && <span className="cell-sub"> · invoiced</span>}
            </li>
          ))}
        </ul>
      )}
      {!timeline.closed && (
        <div className={`next-step ${expectedDelivery.status === 'ON_TRACK' ? '' : 'delivery-warning'}`}>
          <div>
            <strong>Expected delivery: {formatDate(expectedDelivery.requiredBy)}.</strong> {DELIVERY_TEXT[expectedDelivery.status] ?? ''}
            {expectedDelivery.message && <div>{expectedDelivery.message}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
