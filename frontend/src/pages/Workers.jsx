import { useState } from 'react';
import { fieldErrorsOf } from '../api/client.js';
import { workforceApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { can } from '../auth/roles.js';
import { FilterBar, FilterSelect, SearchInput } from '../components/ui/Filters.jsx';
import { Field, Modal } from '../components/ui/Modal.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { EmptyState, ErrorState, ListLimitNotice, LoadingState } from '../components/ui/States.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useFilters } from '../hooks/useFilters.js';
import { DEPARTMENTS, DEPARTMENT_LABELS, WAGE_BASIS_LABELS } from '../utils/attendance.js';
import { formatPaise, rupeesToPaise } from '../utils/format.js';

/** Factory workers (the labour register). The admin adds and edits them and their wage terms. */
export default function Workers() {
  const { user } = useAuth();
  const manage = can.manageWorkers(user.role);
  const filters = useFilters({ q: '', department: '', isActive: 'true' });
  const { q, department, isActive } = filters.filters;
  const list = useApiQuery(() => workforceApi.workers({ ...(q ? { q } : {}), ...(department ? { department } : {}), ...(isActive ? { isActive } : {}), limit: 200 }), [q, department, isActive]);
  const [editing, setEditing] = useState(null); // 'new' | worker
  const workers = list.data?.workers ?? [];
  return (
    <div>
      <PageHeader
        title="Workers"
        subtitle={manage ? 'Workers and their wage terms. A rate change applies to attendance recorded from then on.' : 'Workers in the attendance register.'}
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Workers' }]}
        actions={manage && <button type="button" className="erp-btn-primary" onClick={() => setEditing('new')}>Add worker</button>}
      />
      <div className="erp-card">
        <FilterBar active={filters.active} onClear={filters.clear} label="Worker filters">
          <SearchInput id="wk-search" value={q} onChange={(v) => filters.set('q', v)} placeholder="Search code or name" />
          <FilterSelect id="wk-dept" label="Department" value={department} onChange={(v) => filters.set('department', v)} options={DEPARTMENTS.map((d) => ({ value: d, label: DEPARTMENT_LABELS[d] }))} />
          <FilterSelect id="wk-active" label="Status" value={isActive} onChange={(v) => filters.set('isActive', v)} allLabel="All" options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]} />
        </FilterBar>
        {list.error && <ErrorState error={list.error} onRetry={list.reload} />}
        {!list.error && !list.data && <LoadingState />}
        {list.data && workers.length === 0 && <EmptyState title="No workers found" />}
        {workers.length > 0 && (
          <table className="erp-data-table">
            <thead>
              <tr>
                <th scope="col">Code</th><th scope="col">Name</th><th scope="col">Department</th><th scope="col">Paid by</th>
                {manage && <th scope="col" className="num">Rate</th>}
                <th scope="col">Status</th>
                {manage && <th scope="col"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {workers.map((w) => (
                <tr key={w.id}>
                  <td className="mono">{w.code}</td>
                  <td>{w.name}</td>
                  <td>{DEPARTMENT_LABELS[w.department] ?? w.department}</td>
                  <td>{WAGE_BASIS_LABELS[w.wageBasis]}</td>
                  {manage && <td className="num">{formatPaise(w.ratePaise)}{w.wageBasis === 'HOURLY' ? ' / h' : ' / day'}</td>}
                  <td><StatusBadge tone={w.isActive ? 'success' : 'neutral'} label={w.isActive ? 'Active' : 'Inactive'} /></td>
                  {manage && <td className="row-actions"><button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setEditing(w)}>Edit</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ListLimitNotice shown={workers.length} total={list.meta?.total} />
      </div>
      {editing && <WorkerModal worker={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); list.reload(); }} />}
    </div>
  );
}

function WorkerModal({ worker, onClose, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState({
    code: worker?.code ?? '',
    name: worker?.name ?? '',
    department: worker?.department ?? 'WEAVING',
    wageBasis: worker?.wageBasis ?? 'DAILY',
    rate: worker ? String(worker.ratePaise / 100) : '',
    isActive: worker?.isActive ?? true,
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (field) => (e) => { setForm({ ...form, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }); setErrors({}); setError(null); };

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const ratePaise = rupeesToPaise(form.rate);
    if (ratePaise === null) return setErrors({ ratePaise: 'Enter the rate in rupees (at most 2 decimals).' });
    const body = { name: form.name.trim(), department: form.department, wageBasis: form.wageBasis, ratePaise };
    setBusy(true);
    try {
      if (worker) await workforceApi.updateWorker(worker.id, { ...body, isActive: form.isActive, expectedUpdatedAt: worker.updatedAt });
      else await workforceApi.createWorker({ code: form.code.trim(), ...body });
      toast.success(worker ? `${worker.code} saved.` : `Worker ${form.code.trim().toUpperCase()} added.`);
      onDone();
    } catch (err) {
      setErrors(fieldErrorsOf(err));
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={worker ? `Edit ${worker.code}` : 'Add worker'}
      subtitle={worker ? 'A new rate applies to attendance recorded from now on; past entries keep the rate they were paid at.' : 'The code is unique and cannot be changed later.'}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="worker-form" className="erp-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="worker-form" className="erp-form-grid" onSubmit={submit} noValidate>
        {!worker && (
          <Field label="Code" htmlFor="wk-code" error={errors.code} required>
            <input id="wk-code" className="erp-input" maxLength={20} value={form.code} onChange={set('code')} disabled={busy} placeholder="WK-014" />
          </Field>
        )}
        <Field label="Name" htmlFor="wk-name" error={errors.name} required>
          <input id="wk-name" className="erp-input" maxLength={120} value={form.name} onChange={set('name')} disabled={busy} />
        </Field>
        <Field label="Department" htmlFor="wk-department" required>
          <select id="wk-department" className="erp-input" value={form.department} onChange={set('department')} disabled={busy}>
            {DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>)}
          </select>
        </Field>
        <Field label="Paid by" htmlFor="wk-basis" required>
          <select id="wk-basis" className="erp-input" value={form.wageBasis} onChange={set('wageBasis')} disabled={busy}>
            {Object.entries(WAGE_BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label={form.wageBasis === 'HOURLY' ? 'Rate per hour (₹)' : 'Rate per day (₹)'} htmlFor="wk-rate" error={errors.ratePaise} required>
          <input id="wk-rate" className="erp-input" inputMode="decimal" value={form.rate} onChange={set('rate')} disabled={busy} />
        </Field>
        {worker && (
          <label className="filter-check" htmlFor="wk-active">
            <input id="wk-active" type="checkbox" checked={form.isActive} onChange={set('isActive')} disabled={busy} /> Active (inactive workers leave the daily register; their history stays)
          </label>
        )}
        {error && !Object.keys(errors).length && <p className="login-field-error" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
