import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { fieldErrorsOf } from '../api/client.js';
import { machinesApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { can } from '../auth/roles.js';
import { MachineStatusBadge } from '../components/machines/MachineStatus.jsx';
import { MACHINE_STATUS_LABELS, MACHINE_TYPE_LABELS } from '../utils/machineStatus.js';
import { FilterBar, FilterCheckbox, FilterSelect, SearchInput } from '../components/ui/Filters.jsx';
import { Field, Modal } from '../components/ui/Modal.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, ListLimitNotice, LoadingState } from '../components/ui/States.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useFilters } from '../hooks/useFilters.js';
import { formatDateTime, formatNumber } from '../utils/format.js';

const EMPTY = { code: '', name: '', type: 'WEAVING', ratedMetresPerHour: '', location: '' };
const NO_FILTERS = { q: '', type: '', status: '', retired: false };

function AddMachineModal({ onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const rate = Number(form.ratedMetresPerHour);
    const found = {};
    if (form.code.trim().length < 2) found.code = 'Enter a short code, e.g. W-04.';
    if (form.name.trim().length < 2) found.name = 'Enter the machine name.';
    if (!(rate > 0) || !/^\d+(\.\d{1,2})?$/.test(form.ratedMetresPerHour.trim())) found.ratedMetresPerHour = 'Metres per hour above 0, at most 2 decimals.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const { data } = await machinesApi.create({
        code: form.code.trim(),
        name: form.name.trim(),
        type: form.type,
        ratedMetresPerHour: rate,
        ...(form.location.trim() ? { location: form.location.trim() } : {}),
      });
      toast.success(`Machine ${data.machine.code} registered. It is available for production.`);
      onCreated(data.machine);
    } catch (error) {
      if (error.code === 'DUPLICATE_RESOURCE') setErrors({ code: 'A machine with this code already exists.' });
      else {
        const fields = fieldErrorsOf(error);
        setErrors(fields);
        if (!Object.keys(fields).length) toast.error(error, { title: 'Machine not registered' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Register a machine"
      subtitle="Code and type identify the machine and cannot be changed later."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="machine-form" className="erp-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Register'}</button>
        </>
      }
    >
      <form id="machine-form" className="erp-form-grid two-col" onSubmit={onSubmit} noValidate>
        <Field label="Code" htmlFor="m-code" error={errors.code} hint="e.g. W-04" required>
          <input id="m-code" className="erp-input" value={form.code} onChange={update('code')} disabled={busy} />
        </Field>
        <Field label="Name" htmlFor="m-name" error={errors.name} required>
          <input id="m-name" className="erp-input" value={form.name} onChange={update('name')} disabled={busy} placeholder="Weaving loom 4" />
        </Field>
        <Field label="Type" htmlFor="m-type" error={errors.type} required>
          <select id="m-type" className="erp-input" value={form.type} onChange={update('type')} disabled={busy}>
            {Object.entries(MACHINE_TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="Rated speed (m/hour)" htmlFor="m-rate" error={errors.ratedMetresPerHour} required>
          <input id="m-rate" className="erp-input" inputMode="decimal" value={form.ratedMetresPerHour} onChange={update('ratedMetresPerHour')} disabled={busy} placeholder="15" />
        </Field>
        <Field label="Location (optional)" htmlFor="m-location" error={errors.location}>
          <input id="m-location" className="erp-input" value={form.location} onChange={update('location')} disabled={busy} placeholder="Hall A" />
        </Field>
      </form>
    </Modal>
  );
}

export default function MachineList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const { filters, set, clear, query, active } = useFilters(NO_FILTERS);
  const { retired, ...rest } = query;
  const machines = useApiQuery(() => machinesApi.list({ ...rest, isActive: !retired, limit: 100 }), [query]);
  const list = machines.data?.machines ?? [];
  const counts = list.reduce((acc, machine) => ({ ...acc, [machine.status]: (acc[machine.status] ?? 0) + 1 }), {});

  return (
    <div>
      <PageHeader
        title="Machines"
        subtitle="Every machine on the floor, its state and open problems. Live data."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Machines' }]}
        actions={
          <>
            <button type="button" className="erp-btn-outline" onClick={machines.reload} aria-label="Refresh machines">
              <RefreshCw size={15} className={machines.loading ? 'spin' : ''} aria-hidden="true" /> Refresh
            </button>
            {can.manageMachines(user.role) && (
              <button type="button" className="erp-btn-primary" onClick={() => setAdding(true)}>
                <Plus size={15} aria-hidden="true" /> Register machine
              </button>
            )}
          </>
        }
      />
      <div className="erp-card">
        <FilterBar active={active} onClear={clear} label="Machine filters">
          <SearchInput id="machine-search" value={filters.q} onChange={(value) => set('q', value)} placeholder="Search code, name or location" />
          <FilterSelect id="machine-type" label="Type" value={filters.type} onChange={(value) => set('type', value)} options={Object.entries(MACHINE_TYPE_LABELS).map(([value, label]) => ({ value, label }))} />
          <FilterSelect id="machine-status" label="Status" value={filters.status} onChange={(value) => set('status', value)} options={Object.entries(MACHINE_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
          <FilterCheckbox id="machine-retired" label="Show retired machines instead" checked={filters.retired} onChange={(value) => set('retired', value)} />
          {list.length > 0 && (
            <span className="toolbar-count">
              {Object.entries(counts).map(([status, n]) => `${n} ${MACHINE_STATUS_LABELS[status].toLowerCase()}`).join(' · ')}
            </span>
          )}
        </FilterBar>
        {machines.error && <ErrorState error={machines.error} onRetry={machines.reload} />}
        {!machines.error && !machines.data && <LoadingState label="Loading machines…" />}
        {machines.data && list.length === 0 && (active ? (
          <EmptyState title="No machines match these filters" action={<button type="button" className="erp-btn-outline" onClick={clear}>Clear filters</button>} />
        ) : (
          <EmptyState title="No machines registered yet">
            {can.manageMachines(user.role) ? 'Register the first machine to track its state and problems.' : 'The administrator has not registered any machines yet.'}
          </EmptyState>
        ))}
        {list.length > 0 && (
          <div className="erp-table-wrapper">
            <table className="erp-data-table">
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Machine</th>
                  <th scope="col">Type</th>
                  <th scope="col" className="num">Rated speed</th>
                  <th scope="col">Status</th>
                  <th scope="col">Since</th>
                  <th scope="col" className="num">Open problems</th>
                </tr>
              </thead>
              <tbody>
                {list.map((machine) => (
                  <tr key={machine.id} className="clickable-row" onClick={() => navigate(`/machines/${machine.id}`)}>
                    <td className="mono"><Link to={`/machines/${machine.id}`} onClick={(event) => event.stopPropagation()}>{machine.code}</Link></td>
                    <td className="table-primary-cell">{machine.name}{machine.location && <div className="cell-sub">{machine.location}</div>}</td>
                    <td>{MACHINE_TYPE_LABELS[machine.type] ?? machine.type}</td>
                    <td className="num">{formatNumber(machine.ratedMetresPerHour, 'm/h')}</td>
                    <td><MachineStatusBadge status={machine.status} /></td>
                    <td>{formatDateTime(machine.statusChangedAt)}</td>
                    <td className="num">{machine.openProblems > 0 ? <span className="deadline-chip overdue">{machine.openProblems}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ListLimitNotice shown={list.length} total={machines.meta?.total} />
      </div>
      {adding && (
        <AddMachineModal
          onClose={() => setAdding(false)}
          onCreated={(machine) => {
            setAdding(false);
            navigate(`/machines/${machine.id}`);
          }}
        />
      )}
    </div>
  );
}
