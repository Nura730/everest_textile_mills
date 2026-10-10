import { useState } from 'react';
import { Link } from 'react-router-dom';
import { auditApi, usersApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ROLES, ROLE_LABELS } from '../auth/roles.js';
import { FilterBar, FilterDate, FilterSelect } from '../components/ui/Filters.jsx';
import { ConfirmDialog } from '../components/ui/Modal.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useFilters } from '../hooks/useFilters.js';
import { formatDateTime } from '../utils/format.js';

const PAGE_SIZE = 30;
const NO_FILTERS = { actorId: '', actorRole: '', action: '', from: '', to: '' };
const humanize = (action) => action.charAt(0) + action.slice(1).toLowerCase().replaceAll('_', ' ');

/** Compact one-line view of a before/after object. */
function Change({ before, after }) {
  const show = (value) => (value && typeof value === 'object' ? Object.entries(value).map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : v}`).join(', ') : '');
  const b = show(before);
  const a = show(after);
  if (!a && !b) return <span className="cell-sub">—</span>;
  return (
    <span className="audit-change">
      {b && <span className="cell-sub">{b} → </span>}
      {a}
    </span>
  );
}

/**
 * Audit trail (Phase 13). Each role sees what instruction.md §13 allows (the server decides); the owner
 * sees everything, filters by person, role, action and date, and records corrections as new entries.
 */
export default function AuditTrail() {
  const { user } = useAuth();
  const toast = useToast();
  const admin = user.role === ROLES.ADMIN;
  const { filters, set, clear, query, active, page, setPage } = useFilters(NO_FILTERS);
  const entries = useApiQuery(() => auditApi.list({ ...query, page, limit: PAGE_SIZE }), [query, page]);
  const actions = useApiQuery(() => (admin ? auditApi.actions() : Promise.resolve({ data: { actions: [] } })), [admin]);
  const users = useApiQuery(() => (admin ? usersApi.list({ limit: 100 }) : Promise.resolve({ data: { users: [] } })), [admin]);
  const [correcting, setCorrecting] = useState(null); // { entry, note, busy, error }
  const list = entries.data?.entries ?? [];
  const total = entries.meta?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function saveCorrection() {
    if (correcting.note.trim().length < 5) return setCorrecting({ ...correcting, error: 'Explain the correction (at least 5 characters).' });
    setCorrecting({ ...correcting, busy: true });
    try {
      await auditApi.correct(correcting.entry.id, correcting.note.trim());
      toast.success('Correction recorded. The original entry is unchanged.');
    } catch (error) {
      toast.error(error, { title: 'Correction not saved' });
    }
    setCorrecting(null);
    entries.reload();
  }

  return (
    <div>
      <PageHeader
        title="Audit trail"
        subtitle={admin ? 'Every important action, append-only. Corrections are new entries that point at the original.' : 'Actions relevant to your work. Entries are never edited.'}
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Audit trail' }]}
      />
      <div className="erp-card">
        <FilterBar active={active} onClear={clear} label="Audit filters">
          {admin && <FilterSelect id="au-user" label="Person" value={filters.actorId} onChange={(v) => set('actorId', v)} allLabel="Everyone" options={(users.data?.users ?? []).map((u) => ({ value: u.id, label: u.name }))} />}
          {admin && <FilterSelect id="au-role" label="Role" value={filters.actorRole} onChange={(v) => set('actorRole', v)} allLabel="All roles" options={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))} />}
          {admin && <FilterSelect id="au-action" label="Action" value={filters.action} onChange={(v) => set('action', v)} allLabel="All actions" options={(actions.data?.actions ?? []).map((a) => ({ value: a, label: humanize(a) }))} />}
          <FilterDate id="au-from" label="From" value={filters.from} max={filters.to || undefined} onChange={(v) => set('from', v)} />
          <FilterDate id="au-to" label="To" value={filters.to} min={filters.from || undefined} onChange={(v) => set('to', v)} />
          <span className="toolbar-count">{entries.loading ? 'Loading…' : `${total} entr${total === 1 ? 'y' : 'ies'}`}</span>
        </FilterBar>
        {entries.error && <ErrorState error={entries.error} onRetry={entries.reload} />}
        {!entries.error && !entries.data && <LoadingState />}
        {entries.data && list.length === 0 && <EmptyState title={active ? 'No entries match these filters' : 'No entries yet'} />}
        {list.length > 0 && (
          <div className="erp-table-wrapper">
            <table className="erp-data-table">
              <thead><tr><th scope="col">When</th><th scope="col">Action</th><th scope="col">By</th><th scope="col">Record</th><th scope="col">Change</th><th scope="col">Source</th>{admin && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDateTime(e.at)}</td>
                    <td>{humanize(e.action)}{e.correctsAuditId && <div className="cell-sub">corrects an earlier entry</div>}</td>
                    <td>{e.actorName ?? '—'}<div className="cell-sub">{ROLE_LABELS[e.actorRole] ?? e.actorRole}</div></td>
                    <td>{e.entityType}{e.orderId && <div><Link to={`/orders/${e.orderId}`}>Order</Link></div>}{e.machineId && <div><Link to={`/machines/${e.machineId}`}>Machine</Link></div>}</td>
                    <td><Change before={e.before} after={e.after} /></td>
                    <td><span className="erp-status-badge neutral">{e.source === 'OFFLINE' ? 'Offline' : 'Online'}</span></td>
                    {admin && <td className="row-actions">{e.action !== 'AUDIT_CORRECTION' && <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setCorrecting({ entry: e, note: '' })}>Correct</button>}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="pager">
            <button type="button" className="erp-btn-outline" disabled={page <= 1 || entries.loading} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page} of {pages}</span>
            <button type="button" className="erp-btn-outline" disabled={page >= pages || entries.loading} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </div>
      {correcting && (
        <ConfirmDialog
          title={`Correct "${humanize(correcting.entry.action)}"?`}
          message="A correction is a new audit entry that points at this one and explains what was wrong. The original entry stays exactly as it is."
          confirmLabel="Record correction"
          busy={correcting.busy}
          reason={correcting.note}
          reasonError={correcting.error}
          onReasonChange={(note) => setCorrecting({ ...correcting, note, error: null })}
          onConfirm={saveCorrection}
          onClose={() => setCorrecting(null)}
        />
      )}
    </div>
  );
}
