import { Link, useNavigate } from 'react-router-dom';
import { rollsApi } from '../api/endpoints.js';
import { RollStatusBadge } from '../components/machines/MachineStatus.jsx';
import { FilterBar, FilterSelect, SearchInput } from '../components/ui/Filters.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useFilters } from '../hooks/useFilters.js';
import { formatDateTime, formatNumber } from '../utils/format.js';
import { ROLL_STATUS_LABELS } from '../utils/machineStatus.js';

const PAGE_SIZE = 25;
const NO_FILTERS = { q: '', status: '' };

/** Every produced roll; open one to trace it back to its order, run, machine and yarn. */
export default function RollList() {
  const navigate = useNavigate();
  const { filters, set, clear, query, active, page, setPage } = useFilters(NO_FILTERS);
  const rolls = useApiQuery(() => rollsApi.list({ ...query, page, limit: PAGE_SIZE }), [query, page]);
  const list = rolls.data?.rolls ?? [];
  const total = rolls.meta?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <PageHeader title="Rolls" subtitle="Every roll produced, with its QC status. Open a roll to trace it. Live data." breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Rolls' }]} />
      <div className="erp-card">
        <FilterBar active={active} onClear={clear} label="Roll filters">
          <SearchInput id="roll-search" value={filters.q} onChange={(value) => set('q', value)} placeholder="Search roll, order, run or machine" />
          <FilterSelect id="roll-status" label="Status" value={filters.status} onChange={(value) => set('status', value)} options={Object.entries(ROLL_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
          <span className="toolbar-count">{rolls.loading ? 'Loading…' : `${total} roll${total === 1 ? '' : 's'}`}</span>
        </FilterBar>
        {rolls.error && <ErrorState error={rolls.error} onRetry={rolls.reload} />}
        {!rolls.error && !rolls.data && <LoadingState />}
        {rolls.data && list.length === 0 && <EmptyState title={active ? 'No rolls match these filters' : 'No rolls produced yet'} action={active ? <button type="button" className="erp-btn-outline" onClick={clear}>Clear filters</button> : null} />}
        {list.length > 0 && (
          <div className="erp-table-wrapper">
            <table className="erp-data-table">
              <thead><tr><th scope="col">Roll</th><th scope="col">Order</th><th scope="col">Run</th><th scope="col">Machine</th><th scope="col" className="num">Length</th><th scope="col">Status</th><th scope="col">Produced</th></tr></thead>
              <tbody>
                {list.map((roll) => (
                  <tr key={roll.id} className="clickable-row" onClick={() => navigate(`/rolls/${roll.id}`)}>
                    <td className="mono"><Link to={`/rolls/${roll.id}`} onClick={(e) => e.stopPropagation()}>{roll.rollNumber}</Link></td>
                    <td>{roll.orderNumber}</td>
                    <td>{roll.runNumber}</td>
                    <td>{roll.machineCode}</td>
                    <td className="num">{formatNumber(roll.lengthMetres, 'm')}</td>
                    <td><RollStatusBadge status={roll.status} /></td>
                    <td>{formatDateTime(roll.producedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="pager">
            <button type="button" className="erp-btn-outline" disabled={page <= 1 || rolls.loading} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page} of {pages}</span>
            <button type="button" className="erp-btn-outline" disabled={page >= pages || rolls.loading} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
