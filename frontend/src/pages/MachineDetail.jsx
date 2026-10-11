import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Pencil, Wrench } from 'lucide-react';
import { fieldErrorsOf, newIdempotencyKey } from '../api/client.js';
import { machinesApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { runOrQueue } from '../offline/syncManager.js';
import { CachedNotice } from '../offline/CachedNotice.jsx';
import { PendingActions } from '../offline/PendingActions.jsx';
import { liveMatch, useLive } from '../realtime/realtimeBus.js';
import { ROLE_LABELS, ROLES, can } from '../auth/roles.js';
import { MachineStatusBadge } from '../components/machines/MachineStatus.jsx';
import { MACHINE_STATUS_LABELS, MACHINE_TYPE_LABELS, SEVERITY_TONES } from '../utils/machineStatus.js';
import { FilterBar, FilterDate, FilterSelect } from '../components/ui/Filters.jsx';
import { ConfirmDialog, Field, Modal } from '../components/ui/Modal.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useFilters } from '../hooks/useFilters.js';
import { formatDateTime, formatNumber, formatPaise, rupeesToPaise } from '../utils/format.js';

const CATEGORIES = ['MECHANICAL', 'ELECTRICAL', 'MATERIAL', 'QUALITY', 'OTHER'];
const SEVERITIES = ['LOW', 'MEDIUM', 'CRITICAL'];
const EVENT_LABELS = {
  STATUS_CHANGED: 'Status changed',
  PROBLEM_REPORTED: 'Problem reported',
  PROBLEM_RESOLVED: 'Problem resolved',
  MAINTENANCE_STARTED: 'Maintenance started',
  MAINTENANCE_ENDED: 'Maintenance finished',
  MAINTENANCE_COST_CORRECTED: 'Maintenance cost corrected',
};
const MAINTENANCE_CATEGORY_LABELS = { PREVENTIVE: 'Preventive', BREAKDOWN_REPAIR: 'Breakdown repair', PARTS_REPLACEMENT: 'Parts replacement', CLEANING: 'Cleaning', OTHER: 'Other' };
const titleCase = (value) => value.charAt(0) + value.slice(1).toLowerCase();
const PAGE_SIZE = 20;

function minutesText(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

/** Report a problem. A CRITICAL problem takes the machine DOWN; the form says so before saving. */
function ReportProblemModal({ machine, onClose, onDone }) {
  const toast = useToast();
  const { user } = useAuth();
  const [form, setForm] = useState({ category: 'MECHANICAL', severity: 'MEDIUM', description: '', estimatedDowntimeMinutes: '', pauseProduction: false });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const update = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setKey(newIdempotencyKey());
  };
  const running = machine.status === 'RUNNING';

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const found = {};
    if (form.description.trim().length < 5) found.description = 'Describe the problem (at least 5 characters).';
    const minutes = form.estimatedDowntimeMinutes.trim();
    if (minutes && !/^\d+$/.test(minutes)) found.estimatedDowntimeMinutes = 'Whole minutes.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const body = {
        category: form.category,
        severity: form.severity,
        description: form.description.trim(),
        ...(minutes ? { estimatedDowntimeMinutes: Number(minutes) } : {}),
        ...(form.pauseProduction && form.severity !== 'CRITICAL' ? { pauseProduction: true } : {}),
      };
      const sent = await runOrQueue(
        { key, type: 'MACHINE_PROBLEM_REPORT', payload: { machineId: machine.id, ...body }, label: `${form.severity.toLowerCase()} problem on ${machine.code}`, ref: { machineId: machine.id }, userId: user.id },
        (k) => machinesApi.reportProblem(machine.id, body, k),
      );
      if (sent.queued) {
        toast.info('Saved on this device. It will be sent when the connection returns.', { title: 'Offline' });
        onDone();
        return;
      }
      const { data } = sent.result;
      toast.success(
        data.machine.status === 'DOWN' && machine.status !== 'DOWN'
          ? `Critical problem recorded. ${machine.code} is now down.`
          : `Problem recorded on ${machine.code}.`,
      );
      onDone();
    } catch (error) {
      const fields = fieldErrorsOf(error);
      if (Object.keys(fields).length) setErrors(fields);
      else {
        toast.error(error, { title: 'Problem not recorded' });
        if (error.code === 'INVALID_STATE_TRANSITION' || error.code === 'CONFLICT') onDone();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Report a problem on ${machine.code}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="problem-form" className={form.severity === 'CRITICAL' ? 'erp-btn-danger' : 'erp-btn-primary'} disabled={busy}>
            {busy ? 'Saving…' : form.severity === 'CRITICAL' ? 'Report and take machine down' : 'Report problem'}
          </button>
        </>
      }
    >
      <form id="problem-form" className="erp-form-grid two-col" onSubmit={onSubmit} noValidate>
        <Field label="Problem type" htmlFor="p-cat" required>
          <select id="p-cat" className="erp-input" value={form.category} onChange={update('category')} disabled={busy}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{titleCase(c)}</option>)}
          </select>
        </Field>
        <Field label="Severity" htmlFor="p-sev" required hint={form.severity === 'CRITICAL' ? 'The machine goes DOWN until the problem is resolved.' : 'The machine keeps its current status.'}>
          <select id="p-sev" className="erp-input" value={form.severity} onChange={update('severity')} disabled={busy}>
            {SEVERITIES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </select>
        </Field>
        <Field label="Description" htmlFor="p-desc" error={errors.description} required>
          <textarea id="p-desc" className="erp-input" rows={3} value={form.description} onChange={update('description')} disabled={busy} placeholder="Warp beam brake slipping under load" />
        </Field>
        <Field label="Estimated downtime (minutes, optional)" htmlFor="p-min" error={errors.estimatedDowntimeMinutes}>
          <input id="p-min" className="erp-input" inputMode="numeric" value={form.estimatedDowntimeMinutes} onChange={update('estimatedDowntimeMinutes')} disabled={busy} />
        </Field>
        {running && form.severity !== 'CRITICAL' && (
          <label className="filter-check" htmlFor="p-pause">
            <input id="p-pause" type="checkbox" checked={form.pauseProduction} onChange={update('pauseProduction')} disabled={busy} /> Pause production
          </label>
        )}
      </form>
    </Modal>
  );
}

/**
 * Finish maintenance: the cost is recorded once, now (₹0 if nothing was spent). It is a machine
 * expense, shown in Costing next to order profit, not spread over orders.
 */
function FinishMaintenanceModal({ machine, onClose, onDone }) {
  const toast = useToast();
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [category, setCategory] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const touch = () => { setError(null); setKey(newIdempotencyKey()); };

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const costPaise = rupeesToPaise(cost);
    if (cost.trim() === '' || costPaise === null) return setError('Enter the maintenance cost in rupees (0 if nothing was spent), at most 2 decimals.');
    setBusy(true);
    try {
      await machinesApi.endMaintenance(machine.id, { costPaise, ...(note.trim() ? { note: note.trim() } : {}), ...(category ? { category } : {}), ...(reference.trim() ? { reference: reference.trim() } : {}) }, key);
      toast.success(`${machine.code} is available again. Maintenance cost ${formatPaise(costPaise)} recorded.`, { title: 'Maintenance finished' });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Finish maintenance on ${machine.code}`}
      subtitle="The machine becomes available for production again. Record what the maintenance cost."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="maint-end-form" className="erp-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Finish maintenance'}</button>
        </>
      }
    >
      <form id="maint-end-form" className="erp-form-grid" onSubmit={submit} noValidate>
        <Field label="Maintenance cost (₹)" htmlFor="maint-cost" hint="Parts and labour. Enter 0 if nothing was spent." required>
          <input id="maint-cost" className="erp-input" inputMode="decimal" value={cost} onChange={(e) => { setCost(e.target.value); touch(); }} disabled={busy} placeholder="0" />
        </Field>
        <Field label="Kind of work (optional)" htmlFor="maint-category">
          <select id="maint-category" className="erp-input" value={category} onChange={(e) => { setCategory(e.target.value); touch(); }} disabled={busy}>
            <option value="">—</option>
            {Object.entries(MAINTENANCE_CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="Supplier / bill reference (optional)" htmlFor="maint-ref">
          <input id="maint-ref" className="erp-input" maxLength={60} value={reference} onChange={(e) => { setReference(e.target.value); touch(); }} disabled={busy} />
        </Field>
        <Field label="Note (optional)" htmlFor="maint-note">
          <input id="maint-note" className="erp-input" maxLength={1000} value={note} onChange={(e) => { setNote(e.target.value); touch(); }} disabled={busy} placeholder="Replaced two bearings" />
        </Field>
        {error && <p className="login-field-error" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

/** Admin: correct a finished maintenance's cost with a reason (a new record; the original stays). */
function CorrectCostModal({ machineId, event, onClose, onDone }) {
  const toast = useToast();
  const [cost, setCost] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const touch = () => { setError(null); setKey(newIdempotencyKey()); };

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    const costPaise = rupeesToPaise(cost);
    if (cost.trim() === '' || costPaise === null) return setError('Enter the correct cost in rupees (0 or more, at most 2 decimals).');
    if (reason.trim().length < 5) return setError('Give the reason (at least 5 characters).');
    setBusy(true);
    try {
      await machinesApi.correctMaintenanceCost(machineId, event.id, { costPaise, reason: reason.trim() }, key);
      toast.success(`Maintenance cost corrected to ${formatPaise(costPaise)}.`);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Correct the maintenance cost"
      subtitle={`Recorded ${formatPaise(event.costPaise)} on ${formatDateTime(event.occurredAt)}. The correction and its reason are kept; reports use the latest figure.`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="cost-fix-form" className="erp-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save correction'}</button>
        </>
      }
    >
      <form id="cost-fix-form" className="erp-form-grid" onSubmit={submit} noValidate>
        <Field label="Correct cost (₹)" htmlFor="fix-cost" required>
          <input id="fix-cost" className="erp-input" inputMode="decimal" value={cost} onChange={(e) => { setCost(e.target.value); touch(); }} disabled={busy} />
        </Field>
        <Field label="Reason" htmlFor="fix-reason" required>
          <input id="fix-reason" className="erp-input" maxLength={500} value={reason} onChange={(e) => { setReason(e.target.value); touch(); }} disabled={busy} placeholder="Supplier bill arrived for a different amount" />
        </Field>
        {error && <p className="login-field-error" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

function EditMachineModal({ machine, onClose, onDone }) {
  const toast = useToast();
  const initial = { name: machine.name, ratedMetresPerHour: String(machine.ratedMetresPerHour), location: machine.location ?? '' };
  const [form, setForm] = useState(initial);
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
    if (form.name.trim().length < 2) found.name = 'Enter the machine name.';
    if (!(rate > 0) || !/^\d+(\.\d{1,2})?$/.test(form.ratedMetresPerHour.trim())) found.ratedMetresPerHour = 'Metres per hour above 0, at most 2 decimals.';
    setErrors(found);
    if (Object.keys(found).length) return;
    const changes = {};
    if (form.name.trim() !== machine.name) changes.name = form.name.trim();
    if (rate !== machine.ratedMetresPerHour) changes.ratedMetresPerHour = rate;
    if (form.location.trim() !== (machine.location ?? '')) changes.location = form.location.trim() || null;
    if (!Object.keys(changes).length) return onClose();
    setBusy(true);
    try {
      await machinesApi.update(machine.id, { ...changes, expectedUpdatedAt: machine.updatedAt });
      toast.success(`${machine.code} updated.`);
      onDone();
    } catch (error) {
      if (error.code === 'CONFLICT') {
        toast.error(error, { title: 'Changed by someone else' });
        onDone();
      } else {
        const fields = fieldErrorsOf(error);
        setErrors(fields);
        if (!Object.keys(fields).length) toast.error(error, { title: 'Machine not updated' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Edit ${machine.code}`}
      subtitle="Code and type identify the machine and cannot be changed. Status changes only through maintenance and problems."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="edit-machine-form" className="erp-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </>
      }
    >
      <form id="edit-machine-form" className="erp-form-grid" onSubmit={onSubmit} noValidate>
        <div className="readonly-grid" aria-label="Fixed machine identity">
          <div><span>Code</span>{machine.code}</div>
          <div><span>Type</span>{MACHINE_TYPE_LABELS[machine.type]}</div>
          <div><span>Status</span>{MACHINE_STATUS_LABELS[machine.status]}</div>
        </div>
        <Field label="Name" htmlFor="em-name" error={errors.name} required>
          <input id="em-name" className="erp-input" value={form.name} onChange={update('name')} disabled={busy} />
        </Field>
        <Field label="Rated speed (m/hour)" htmlFor="em-rate" error={errors.ratedMetresPerHour} required>
          <input id="em-rate" className="erp-input" inputMode="decimal" value={form.ratedMetresPerHour} onChange={update('ratedMetresPerHour')} disabled={busy} />
        </Field>
        <Field label="Location" htmlFor="em-loc" error={errors.location} hint="Leave empty to remove.">
          <input id="em-loc" className="erp-input" value={form.location} onChange={update('location')} disabled={busy} />
        </Field>
      </form>
    </Modal>
  );
}

const NO_EVENT_FILTERS = { type: '', from: '', to: '' };

function History({ machineId, refreshKey, canCorrectCost }) {
  const [correcting, setCorrecting] = useState(null);
  const { filters, set, clear, query, active, page, setPage } = useFilters(NO_EVENT_FILTERS);
  const events = useApiQuery(() => machinesApi.events(machineId, { ...query, page, limit: PAGE_SIZE }), [machineId, query, page, refreshKey]);
  const list = events.data?.events ?? [];
  const pages = Math.max(1, Math.ceil((events.meta?.total ?? 0) / PAGE_SIZE));
  return (
    <div className="erp-card section-gap">
      <h3 className="card-title">History</h3>
      <p className="card-subtitle">Every status change, problem and maintenance, newest first. Entries are never edited.</p>
      <FilterBar active={active} onClear={clear} label="History filters">
        <FilterSelect id="ev-type" label="Event" value={filters.type} onChange={(value) => set('type', value)} allLabel="All events" options={Object.entries(EVENT_LABELS).map(([value, label]) => ({ value, label }))} />
        <FilterDate id="ev-from" label="From" value={filters.from} max={filters.to || undefined} onChange={(value) => set('from', value)} />
        <FilterDate id="ev-to" label="To" value={filters.to} min={filters.from || undefined} onChange={(value) => set('to', value)} />
      </FilterBar>
      {events.error && <ErrorState error={events.error} onRetry={events.reload} />}
      {!events.error && !events.data && <LoadingState />}
      {events.data && list.length === 0 && <EmptyState title={active ? 'No events match these filters' : 'No history yet'} />}
      {list.length > 0 && (
        <table className="erp-data-table">
          <thead>
            <tr><th scope="col">When</th><th scope="col">Event</th><th scope="col">Status</th><th scope="col">Details</th><th scope="col">By</th></tr>
          </thead>
          <tbody>
            {list.map((event) => (
              <tr key={event.id}>
                <td>{formatDateTime(event.occurredAt)}</td>
                <td>{EVENT_LABELS[event.type] ?? event.type}</td>
                <td>{event.fromStatus === event.toStatus ? MACHINE_STATUS_LABELS[event.toStatus] : `${MACHINE_STATUS_LABELS[event.fromStatus]} → ${MACHINE_STATUS_LABELS[event.toStatus]}`}</td>
                <td>
                  {event.problem && (
                    <>
                      <span className={`erp-status-badge ${SEVERITY_TONES[event.problem.severity]}`}>{titleCase(event.problem.severity)}</span>{' '}
                      {titleCase(event.problem.category)}: {event.problem.description}
                    </>
                  )}
                  {!event.problem && (event.note ?? '—')}
                  {event.costPaise !== null && event.costPaise !== undefined && (
                    <div className="cell-sub">
                      {event.type === 'MAINTENANCE_COST_CORRECTED' ? 'Corrected cost' : 'Maintenance cost'} {formatPaise(event.costPaise)}
                      {event.maintenanceCategory && ` · ${MAINTENANCE_CATEGORY_LABELS[event.maintenanceCategory]}`}
                      {event.reference && ` · ref ${event.reference}`}
                      {event.downtimeMinutes !== null && event.downtimeMinutes !== undefined && ` · down ${minutesText(event.downtimeMinutes)}`}
                    </div>
                  )}
                  {canCorrectCost && event.type === 'MAINTENANCE_ENDED' && (
                    <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setCorrecting(event)}>Correct cost</button>
                  )}
                </td>
                <td>{ROLE_LABELS[event.actorRole] ?? event.actorRole}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pages > 1 && (
        <div className="pager">
          <button type="button" className="erp-btn-outline" disabled={page <= 1 || events.loading} onClick={() => setPage(page - 1)}>Previous</button>
          <span>Page {page} of {pages}</span>
          <button type="button" className="erp-btn-outline" disabled={page >= pages || events.loading} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
      {correcting && <CorrectCostModal machineId={machineId} event={correcting} onClose={() => setCorrecting(null)} onDone={() => { setCorrecting(null); events.reload(); }} />}
    </div>
  );
}

export default function MachineDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const detail = useApiQuery(() => machinesApi.get(id), [id], { cacheKey: `machine:${id}` });
  useLive(liveMatch.machine(id), detail.reload);
  const [modal, setModal] = useState(null); // 'problem' | 'edit' | { resolve: event, text, key, busy, error } | { maintenance: 'start'|'end', key, busy } | { retire, busy }
  const [refreshKey, setRefreshKey] = useState(0);
  const reload = () => {
    detail.reload();
    setRefreshKey((n) => n + 1);
  };

  if (detail.error) {
    return (
      <div>
        <PageHeader title="Machine" breadcrumbs={[{ label: 'Machines', to: '/machines' }, { label: 'Not available' }]} />
        <ErrorState error={detail.error} onRetry={detail.error.status === 404 ? undefined : detail.reload} />
      </div>
    );
  }
  if (!detail.data) return <LoadingState label="Loading machine…" />;

  const { machine, openProblems, downtime } = detail.data;
  const operate = can.operateMachines(user.role) && machine.isActive;
  const manage = can.manageMachines(user.role);

  async function runAction(call, success) {
    setModal((current) => ({ ...current, busy: true, error: null }));
    try {
      await call();
      toast.success(success);
      setModal(null);
    } catch (error) {
      const fields = fieldErrorsOf(error);
      if (Object.keys(fields).length) {
        setModal((current) => ({ ...current, busy: false, error: Object.values(fields)[0] }));
        return;
      }
      toast.error(error, { title: 'Not saved' });
      setModal(null);
    }
    reload();
  }

  return (
    <div>
      <PageHeader
        title={`${machine.code} · ${machine.name}`}
        subtitle={`${MACHINE_TYPE_LABELS[machine.type]} · rated ${formatNumber(machine.ratedMetresPerHour, 'm/h')}${machine.location ? ` · ${machine.location}` : ''}${machine.isActive ? '' : ' · retired'}`}
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Machines', to: '/machines' }, { label: machine.code }]}
        actions={
          <>
            {operate && (
              <button type="button" className="erp-btn-danger" onClick={() => setModal('problem')}>
                <AlertTriangle size={15} aria-hidden="true" /> Report problem
              </button>
            )}
            {operate && machine.status === 'AVAILABLE' && (
              <button type="button" className="erp-btn-outline" onClick={() => setModal({ maintenance: 'start', key: newIdempotencyKey() })}>
                <Wrench size={15} aria-hidden="true" /> Start maintenance
              </button>
            )}
            {operate && machine.status === 'MAINTENANCE' && (
              <button type="button" className="erp-btn-primary" onClick={() => setModal({ maintenance: 'end', key: newIdempotencyKey() })}>
                <CheckCircle2 size={15} aria-hidden="true" /> Finish maintenance
              </button>
            )}
            {manage && (
              <button type="button" className="erp-btn-outline" onClick={() => setModal('edit')}>
                <Pencil size={15} aria-hidden="true" /> Edit
              </button>
            )}
            {manage && (
              <button type="button" className="erp-btn-outline" onClick={() => setModal({ retire: true })}>
                {machine.isActive ? 'Retire' : 'Reactivate'}
              </button>
            )}
          </>
        }
      />
      <CachedNotice cachedAt={detail.cachedAt} />
      <PendingActions match={(item) => item.ref?.machineId === id} onApplied={() => detail.reload()} />

      <div className="erp-tall-kpi-grid">
        <div className="erp-card"><div className="detail-label">Status</div><div className="detail-value"><MachineStatusBadge status={machine.status} /></div><div className="cell-sub">since {formatDateTime(machine.statusChangedAt)}</div></div>
        <div className="erp-card"><div className="detail-label">Open problems</div><div className="detail-value">{openProblems.length}</div></div>
        <div className="erp-card"><div className="detail-label">Current run</div><div className="detail-value">{machine.currentRunId ? <Link to={`/production/${machine.currentRunId}`}>View run</Link> : 'None'}</div></div>
        <div className="erp-card"><div className="detail-label">Downtime (critical problems)</div><div className="detail-value">{minutesText(downtime.totalMinutes)}</div><div className="cell-sub">{downtime.criticalProblems} critical{downtime.ongoing ? ' · ongoing' : ''}</div></div>
      </div>

      <div className="erp-card section-gap">
        <h3 className="card-title">Open problems</h3>
        <p className="card-subtitle">A critical problem keeps the machine down until it is resolved.</p>
        {openProblems.length === 0 ? (
          <EmptyState title="No open problems" />
        ) : (
          <table className="erp-data-table">
            <thead>
              <tr><th scope="col">Reported</th><th scope="col">Severity</th><th scope="col">Problem</th><th scope="col" className="num">Est. downtime</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {openProblems.map((event) => (
                <tr key={event.id}>
                  <td>{formatDateTime(event.occurredAt)}</td>
                  <td><span className={`erp-status-badge ${SEVERITY_TONES[event.problem.severity]}`}>{titleCase(event.problem.severity)}</span></td>
                  <td>{titleCase(event.problem.category)}: {event.problem.description}</td>
                  <td className="num">{event.problem.estimatedDowntimeMinutes !== null ? minutesText(event.problem.estimatedDowntimeMinutes) : '—'}</td>
                  <td className="row-actions">
                    {operate && (
                      <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setModal({ resolve: event, text: '', key: newIdempotencyKey() })}>
                        Resolve
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <History machineId={machine.id} refreshKey={refreshKey} canCorrectCost={user.role === ROLES.ADMIN} />

      {modal === 'problem' && <ReportProblemModal machine={machine} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'edit' && <EditMachineModal machine={machine} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal?.resolve && (
        <ConfirmDialog
          title="Resolve this problem?"
          message={`${titleCase(modal.resolve.problem.category)}: ${modal.resolve.problem.description}${modal.resolve.problem.severity === 'CRITICAL' && openProblems.filter((p) => p.problem.severity === 'CRITICAL').length === 1 ? ' — this is the last critical problem, so the machine comes back into service.' : ''}`}
          confirmLabel="Resolve"
          busy={modal.busy}
          reason={modal.text}
          reasonError={modal.error}
          onReasonChange={(text) => setModal({ ...modal, text, error: null, key: newIdempotencyKey() })}
          onConfirm={() => {
            if (modal.text.trim().length < 5) return setModal({ ...modal, error: 'Describe the fix (at least 5 characters).' });
            return runAction(() => machinesApi.resolveProblem(machine.id, modal.resolve.id, modal.text.trim(), modal.key), 'Problem resolved.');
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.maintenance === 'end' && <FinishMaintenanceModal machine={machine} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal?.maintenance === 'start' && (
        <ConfirmDialog
          title={modal.maintenance === 'start' ? `Start maintenance on ${machine.code}?` : `Finish maintenance on ${machine.code}?`}
          message={modal.maintenance === 'start' ? 'The machine cannot take production while in maintenance.' : 'The machine becomes available for production again.'}
          confirmLabel={modal.maintenance === 'start' ? 'Start maintenance' : 'Finish maintenance'}
          busy={modal.busy}
          onConfirm={() =>
            runAction(
              () => (modal.maintenance === 'start' ? machinesApi.startMaintenance(machine.id, {}, modal.key) : machinesApi.endMaintenance(machine.id, {}, modal.key)),
              modal.maintenance === 'start' ? `${machine.code} is in maintenance.` : `${machine.code} is available again.`,
            )
          }
          onClose={() => setModal(null)}
        />
      )}
      {modal?.retire && (
        <ConfirmDialog
          title={machine.isActive ? `Retire ${machine.code}?` : `Reactivate ${machine.code}?`}
          message={machine.isActive ? 'A retired machine is hidden from the floor and cannot take production. Its history is kept.' : 'The machine returns to the floor list.'}
          confirmLabel={machine.isActive ? 'Retire' : 'Reactivate'}
          danger={machine.isActive}
          busy={modal.busy}
          onConfirm={() => runAction(() => machinesApi.setActive(machine.id, !machine.isActive), machine.isActive ? `${machine.code} retired.` : `${machine.code} reactivated.`)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
