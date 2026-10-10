import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { machinesApi, productionApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { liveMatch, useLive } from '../realtime/realtimeBus.js';
import { CachedNotice } from '../offline/CachedNotice.jsx';
import { can } from '../auth/roles.js';
import { RunStatusBadge } from '../components/machines/MachineStatus.jsx';
import { PlanRunModal } from '../components/production/PlanRunModal.jsx';
import { FilterBar, FilterSelect } from '../components/ui/Filters.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useFilters } from '../hooks/useFilters.js';
import { formatDateTime, formatNumber } from '../utils/format.js';
import { RUN_STATUS_LABELS } from '../utils/machineStatus.js';

const PAGE_SIZE = 20;
const NO_FILTERS = { status: '', machineId: '' };

/** Produced against target, as a bar. */
export function RunProgress({ run }) {
  const pct = run.targetMetres > 0 ? Math.min(100, (run.producedMetres / run.targetMetres) * 100) : 0;
  return (
    <div className="run-progress" title={`${formatNumber(run.producedMetres, 'm')} of ${formatNumber(run.targetMetres, 'm')}`}>
      <div className="stock-bar"><div className="stock-bar-fill" style={{ width: `${pct}%` }} /></div>
      <span className="cell-sub">{formatNumber(run.producedMetres, 'm')} / {formatNumber(run.targetMetres, 'm')}</span>
    </div>
  );
}

export default function ProductionList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [planning, setPlanning] = useState(false);
  const { filters, set, clear, query, active, page, setPage } = useFilters(NO_FILTERS);
  const runs = useApiQuery(() => productionApi.list({ ...query, page, limit: PAGE_SIZE }), [query, page], { cacheKey: `runs:${JSON.stringify(query)}:${page}` });
  useLive(liveMatch.actions('RUN_', 'ROLL_'), runs.reload);
  // The machine filter needs the machine list, which only machine viewers may read.
  const machineViewer = can.operateMachines(user.role) || user.role === 'QC_INSPECTOR';
  const machines = useApiQuery(() => (machineViewer ? machinesApi.list({ limit: 100 }) : Promise.resolve({ data: { machines: [] } })), [machineViewer]);
  const list = runs.data?.runs ?? [];
  const total = runs.meta?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader
        title="Production"
        subtitle="Production runs: which order is on which machine, and how much has been produced. Live data."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Production' }]}
        actions={
          <>
            <button type="button" className="erp-btn-outline" onClick={runs.reload} aria-label="Refresh runs">
              <RefreshCw size={15} className={runs.loading ? 'spin' : ''} aria-hidden="true" /> Refresh
            </button>
            {can.runProduction(user.role) && (
              <button type="button" className="erp-btn-primary" onClick={() => setPlanning(true)}>
                <Plus size={15} aria-hidden="true" /> Plan run
              </button>
            )}
          </>
        }
      />
      <CachedNotice cachedAt={runs.cachedAt} />
      <div className="erp-card">
        <FilterBar active={active} onClear={clear} label="Run filters">
          <FilterSelect id="run-status" label="Status" value={filters.status} onChange={(value) => set('status', value)} options={Object.entries(RUN_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
          {machineViewer && (
            <FilterSelect id="run-machine" label="Machine" value={filters.machineId} onChange={(value) => set('machineId', value)} allLabel="All machines" options={(machines.data?.machines ?? []).map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` }))} />
          )}
          <span className="toolbar-count">{runs.loading ? 'Loading…' : `${total} run${total === 1 ? '' : 's'}`}</span>
        </FilterBar>
        {runs.error && <ErrorState error={runs.error} onRetry={runs.reload} />}
        {!runs.error && !runs.data && <LoadingState label="Loading runs…" />}
        {runs.data && list.length === 0 && (active ? (
          <EmptyState title="No runs match these filters" action={<button type="button" className="erp-btn-outline" onClick={clear}>Clear filters</button>} />
        ) : (
          <EmptyState title="No production runs yet">
            {can.runProduction(user.role) ? 'Plan a run for an order whose yarn is reserved.' : 'Runs appear here once the floor plans production.'}
          </EmptyState>
        ))}
        {list.length > 0 && (
          <div className="erp-table-wrapper">
            <table className="erp-data-table">
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Order</th>
                  <th scope="col">Machine</th>
                  <th scope="col">Progress</th>
                  <th scope="col" className="num">Rolls</th>
                  <th scope="col">Status</th>
                  <th scope="col">Started</th>
                </tr>
              </thead>
              <tbody>
                {list.map((run) => (
                  <tr key={run.id} className="clickable-row" onClick={() => navigate(`/production/${run.id}`)}>
                    <td className="mono"><Link to={`/production/${run.id}`} onClick={(event) => event.stopPropagation()}>{run.runNumber}</Link></td>
                    <td><Link to={`/orders/${run.orderId}`} onClick={(event) => event.stopPropagation()}>{run.orderNumber}</Link></td>
                    <td>{run.machineCode}</td>
                    <td><RunProgress run={run} /></td>
                    <td className="num">{run.rollCount}</td>
                    <td><RunStatusBadge status={run.status} /></td>
                    <td>{run.startedAt ? formatDateTime(run.startedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="pager">
            <button type="button" className="erp-btn-outline" disabled={page <= 1 || runs.loading} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page} of {pages}</span>
            <button type="button" className="erp-btn-outline" disabled={page >= pages || runs.loading} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </div>
      {planning && <PlanRunModal onClose={() => setPlanning(false)} onDone={(run) => navigate(`/production/${run.id}`)} />}
    </div>
  );
}
