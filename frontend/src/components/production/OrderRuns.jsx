import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { productionApi } from '../../api/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { formatNumber } from '../../utils/format.js';
import { RunStatusBadge } from '../machines/MachineStatus.jsx';
import { EmptyState, ErrorState, LoadingState } from '../ui/States.jsx';
import { PlanRunModal } from './PlanRunModal.jsx';

/** An order's production runs and overall progress; the floor can plan another run here. */
export function OrderRunsPanel({ order, canPlan, onChanged }) {
  const runs = useApiQuery(() => productionApi.list({ orderId: order.id, limit: 100 }), [order.id, order.updatedAt]);
  const [planning, setPlanning] = useState(false);
  const list = runs.data?.runs ?? [];
  const produced = list.reduce((sum, run) => sum + run.producedMetres, 0);
  const plannable = canPlan && ['MATERIAL_RESERVED', 'IN_PRODUCTION'].includes(order.status);

  return (
    <div className="erp-card section-gap">
      <div className="card-header">
        <div>
          <h3 className="card-title">Production</h3>
          <p className="card-subtitle">{formatNumber(produced, 'm')} of {formatNumber(order.quantityMetres, 'm')} produced across {list.length} run{list.length === 1 ? '' : 's'}.</p>
        </div>
        {plannable && (
          <button type="button" className="erp-btn-primary" onClick={() => setPlanning(true)}>
            <Plus size={15} aria-hidden="true" /> Plan run
          </button>
        )}
      </div>
      {runs.error && <ErrorState error={runs.error} onRetry={runs.reload} />}
      {!runs.error && !runs.data && <LoadingState />}
      {runs.data && list.length === 0 && <EmptyState title="No runs yet">{plannable ? 'Plan a run on an available machine to start production.' : 'The floor plans production once the yarn is reserved.'}</EmptyState>}
      {list.length > 0 && (
        <table className="erp-data-table">
          <thead><tr><th scope="col">Run</th><th scope="col">Machine</th><th scope="col" className="num">Target</th><th scope="col" className="num">Produced</th><th scope="col" className="num">Rolls</th><th scope="col">Status</th></tr></thead>
          <tbody>
            {list.map((run) => (
              <tr key={run.id}>
                <td className="mono"><Link to={`/production/${run.id}`}>{run.runNumber}</Link></td>
                <td>{run.machineCode}</td>
                <td className="num">{formatNumber(run.targetMetres, 'm')}</td>
                <td className="num">{formatNumber(run.producedMetres, 'm')}</td>
                <td className="num">{run.rollCount}</td>
                <td><RunStatusBadge status={run.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {planning && (
        <PlanRunModal
          order={order}
          onClose={() => setPlanning(false)}
          onDone={() => {
            setPlanning(false);
            runs.reload();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
