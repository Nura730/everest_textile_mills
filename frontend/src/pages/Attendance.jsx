import { useState } from 'react';
import { Link } from 'react-router-dom';
import { newIdempotencyKey } from '../api/client.js';
import { workforceApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { can } from '../auth/roles.js';
import { FilterBar, FilterDate, FilterSelect } from '../components/ui/Filters.jsx';
import { Field, Modal } from '../components/ui/Modal.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { CachedNotice } from '../offline/CachedNotice.jsx';
import { PendingActions } from '../offline/PendingActions.jsx';
import { runOrQueue } from '../offline/syncManager.js';
import { liveMatch, useLive } from '../realtime/realtimeBus.js';
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_TONES,
  DEPARTMENTS,
  DEPARTMENT_LABELS,
  WAGE_BASIS_LABELS,
  attendanceEntry,
  canCorrect,
  todayInIndia,
} from '../utils/attendance.js';
import { formatNumber, formatPaise } from '../utils/format.js';

/**
 * The daily attendance register: every active worker, marked present, half day or absent (hours for
 * hourly-rated workers). One entry per worker per day; mistakes are corrected with a reason, never
 * re-entered. Works offline: entries are kept on the device and sent when the connection returns.
 * The wage is computed by the server; only the admin sees money.
 */
export default function Attendance() {
  const { user } = useAuth();
  const toast = useToast();
  const today = todayInIndia();
  const [date, setDate] = useState(today);
  const [department, setDepartment] = useState('');
  const [marks, setMarks] = useState({}); // workerId → { status, hours, error }
  const [busy, setBusy] = useState(false);
  const [correcting, setCorrecting] = useState(null);
  const register = useApiQuery(() => workforceApi.register({ date, ...(department ? { department } : {}) }), [date, department], { cacheKey: `attendance:${date}:${department}` });
  useLive(liveMatch.actions('ATTENDANCE_', 'WORKER_'), register.reload);
  const recorder = can.recordAttendance(user.role);
  const money = can.viewWages(user.role);
  const rows = register.data?.rows ?? [];
  const totals = register.data?.totals;

  const setMark = (workerId, patch) => setMarks((m) => ({ ...m, [workerId]: { ...m[workerId], ...patch, error: null } }));

  async function save(list) {
    if (busy) return;
    setBusy(true);
    let saved = 0;
    let queued = 0;
    const next = { ...marks };
    for (const row of list) {
      const mark = marks[row.worker.id] ?? {};
      const { body, error } = attendanceEntry({ worker: row.worker, date, status: mark.status, hours: mark.hours });
      if (error) {
        next[row.worker.id] = { ...mark, error };
        continue;
      }
      const key = mark.key ?? newIdempotencyKey();
      try {
        const sent = await runOrQueue(
          { key, type: 'ATTENDANCE_RECORD', payload: body, label: `Attendance ${row.worker.code} ${date}: ${ATTENDANCE_LABELS[body.status]}`, ref: { attendance: true }, userId: user.id },
          (k) => workforceApi.record(body, k),
        );
        if (sent.queued) queued += 1;
        else saved += 1;
        delete next[row.worker.id];
      } catch (err) {
        next[row.worker.id] = { ...mark, key, error: err.message };
      }
    }
    setMarks(next);
    setBusy(false);
    if (saved) toast.success(`${saved} attendance entr${saved === 1 ? 'y' : 'ies'} saved.`);
    if (queued) toast.info(`${queued} saved on this device. They will be sent when the connection returns.`, { title: 'Offline' });
    register.reload();
  }

  const pending = rows.filter((r) => !r.attendance && marks[r.worker.id]?.status);
  return (
    <div>
      <PageHeader
        title="Attendance"
        subtitle={recorder ? 'Mark each worker for the day. One entry per worker per day; correct mistakes with a reason.' : 'The attendance register (read only).'}
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Attendance' }]}
        actions={
          <>
            {can.manageWorkers(user.role) && <Link className="erp-btn-outline" to="/workers">Workers</Link>}
            {money && <Link className="erp-btn-outline" to="/wages">Wages</Link>}
          </>
        }
      />
      <PendingActions title="Attendance saved on this device" match={(item) => item.type === 'ATTENDANCE_RECORD'} onApplied={register.reload} />
      <div className="erp-card">
        <FilterBar active={date !== today || department !== ''} onClear={() => { setDate(today); setDepartment(''); }} label="Register filters">
          <FilterDate id="att-date" label="Date" value={date} max={today} onChange={(v) => { setDate(v || today); setMarks({}); }} />
          <FilterSelect id="att-dept" label="Department" value={department} onChange={setDepartment} options={DEPARTMENTS.map((d) => ({ value: d, label: DEPARTMENT_LABELS[d] }))} />
        </FilterBar>
        {register.error && <ErrorState error={register.error} onRetry={register.reload} />}
        {!register.error && !register.data && <LoadingState label="Loading the register…" />}
        {totals && (
          <p className="card-subtitle" aria-live="polite">
            {totals.recorded} of {totals.workers} recorded · present {totals.present} · half day {totals.halfDay} · absent {totals.absent}
            {totals.notRecorded > 0 && ` · ${totals.notRecorded} not recorded yet`}
          </p>
        )}
        {register.data && rows.length === 0 && (
          <EmptyState title="No workers">{can.manageWorkers(user.role) ? <Link to="/workers">Add workers</Link> : 'The admin adds workers.'}</EmptyState>
        )}
        {rows.length > 0 && (
          <table className="erp-data-table">
            <thead>
              <tr>
                <th scope="col">Worker</th>
                <th scope="col">Department</th>
                <th scope="col">Paid by</th>
                <th scope="col">Attendance</th>
                {money && <th scope="col" className="num">Wage</th>}
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ worker, attendance }) => {
                const mark = marks[worker.id] ?? {};
                return (
                  <tr key={worker.id}>
                    <td><span className="mono">{worker.code}</span> {worker.name}{!worker.isActive && <span className="cell-sub"> · inactive</span>}</td>
                    <td>{DEPARTMENT_LABELS[worker.department] ?? worker.department}</td>
                    <td>{WAGE_BASIS_LABELS[worker.wageBasis]}</td>
                    <td>
                      {attendance ? (
                        <>
                          <StatusBadge tone={ATTENDANCE_TONES[attendance.status]} label={ATTENDANCE_LABELS[attendance.status]} />
                          {attendance.hours !== null && <span className="cell-sub"> {formatNumber(attendance.hours)} h</span>}
                          {attendance.corrections.length > 0 && <div className="cell-sub">Corrected: {attendance.corrections.at(-1).reason}</div>}
                          {attendance.source === 'OFFLINE' && <div className="cell-sub">Entered offline</div>}
                        </>
                      ) : recorder ? (
                        <div className="row-actions" role="group" aria-label={`Attendance for ${worker.name}`}>
                          {Object.entries(ATTENDANCE_LABELS).map(([status, label]) => (
                            <button key={status} type="button" className={mark.status === status ? 'erp-btn-primary erp-btn-sm' : 'erp-btn-outline erp-btn-sm'} aria-pressed={mark.status === status} onClick={() => setMark(worker.id, { status, key: newIdempotencyKey() })} disabled={busy}>
                              {label}
                            </button>
                          ))}
                          {worker.wageBasis === 'HOURLY' && mark.status && mark.status !== 'ABSENT' && (
                            <input className="erp-input" style={{ width: 80, padding: "4px 8px" }} inputMode="decimal" aria-label={`Hours worked by ${worker.name}`} placeholder="Hours" value={mark.hours ?? ''} onChange={(e) => setMark(worker.id, { hours: e.target.value, key: newIdempotencyKey() })} disabled={busy} />
                          )}
                          {mark.error && <span className="login-field-error" role="alert">{mark.error}</span>}
                        </div>
                      ) : (
                        <span className="cell-sub">Not recorded</span>
                      )}
                    </td>
                    {money && <td className="num">{attendance?.wagePaise !== undefined ? formatPaise(attendance.wagePaise) : '—'}</td>}
                    <td className="row-actions">
                      {!attendance && recorder && mark.status && <button type="button" className="erp-btn-primary erp-btn-sm" onClick={() => save([{ worker }])} disabled={busy}>Save</button>}
                      {attendance && canCorrect(user.role, attendance.date, today) && (
                        <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setCorrecting({ worker, attendance })}>Correct</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {recorder && pending.length > 1 && (
          <div className="row-actions section-gap">
            <button type="button" className="erp-btn-primary" onClick={() => save(pending)} disabled={busy}>{busy ? 'Saving…' : `Save ${pending.length} marked entries`}</button>
          </div>
        )}
        <CachedNotice cachedAt={register.cachedAt} />
      </div>
      {correcting && <CorrectModal {...correcting} onClose={() => setCorrecting(null)} onDone={() => { setCorrecting(null); register.reload(); }} />}
    </div>
  );
}

/** Correct one entry: new status and/or hours, with the reason (kept with the entry and in the audit). */
function CorrectModal({ worker, attendance, onClose, onDone }) {
  const toast = useToast();
  const [status, setStatus] = useState(attendance.status);
  const [hours, setHours] = useState(attendance.hours === null ? '' : String(attendance.hours));
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (reason.trim().length < 5) return setError('Give the reason for the correction (at least 5 characters).');
    const { body, error: invalid } = attendanceEntry({ worker, date: attendance.date, status, hours });
    if (invalid) return setError(invalid);
    setBusy(true);
    try {
      await workforceApi.correct(attendance.id, { status: body.status, ...(body.hours !== undefined ? { hours: body.hours } : {}), reason: reason.trim(), expectedUpdatedAt: attendance.updatedAt });
      toast.success(`Attendance of ${worker.code} on ${attendance.date} corrected.`);
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Correct ${worker.code} ${worker.name} — ${attendance.date}`}
      subtitle={`Recorded as ${ATTENDANCE_LABELS[attendance.status]}${attendance.hours !== null ? `, ${attendance.hours} h` : ''}. The change and its reason are kept with the entry.`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="att-correct-form" className="erp-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save correction'}</button>
        </>
      }
    >
      <form id="att-correct-form" className="erp-form-grid" onSubmit={submit} noValidate>
        <Field label="Attendance" htmlFor="att-correct-status" required>
          <select id="att-correct-status" className="erp-input" value={status} onChange={(e) => { setStatus(e.target.value); setError(null); }} disabled={busy}>
            {Object.entries(ATTENDANCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        {worker.wageBasis === 'HOURLY' && status !== 'ABSENT' && (
          <Field label="Hours worked" htmlFor="att-correct-hours" required>
            <input id="att-correct-hours" className="erp-input" inputMode="decimal" value={hours} onChange={(e) => { setHours(e.target.value); setError(null); }} disabled={busy} />
          </Field>
        )}
        <Field label="Reason" htmlFor="att-correct-reason" required>
          <input id="att-correct-reason" className="erp-input" maxLength={500} value={reason} onChange={(e) => { setReason(e.target.value); setError(null); }} disabled={busy} placeholder="Left after lunch" />
        </Field>
        {error && <p className="login-field-error" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}
