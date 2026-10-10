import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Pause, Play, PlusCircle, XOctagon } from 'lucide-react';
import { fieldErrorsOf, newIdempotencyKey } from '../api/client.js';
import { productionApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ROLE_LABELS, can } from '../auth/roles.js';
import { RunStatusBadge } from '../components/machines/MachineStatus.jsx';
import { ConfirmDialog, Field, Modal } from '../components/ui/Modal.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { formatDateTime, formatNumber } from '../utils/format.js';
import { RUN_STATUS_LABELS } from '../utils/machineStatus.js';
import { RunProgress } from './ProductionList.jsx';

const ROLL_STATUS_LABELS = { QC_PENDING: 'Awaiting QC', QC_PASSED: 'QC passed', IN_REWORK: 'In rework', REJECTED: 'Rejected', FINISHED: 'Finished' };

/** Record one produced roll. Weight is optional (a roll may be weighed later). */
function RecordRollModal({ run, onClose, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState({ lengthMetres: '', weightKg: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors({});
    setKey(newIdempotencyKey());
  };

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const length = form.lengthMetres.trim();
    const weight = form.weightKg.trim();
    const found = {};
    if (!/^\d+(\.\d{1,2})?$/.test(length) || Number(length) <= 0) found.lengthMetres = 'Metres above 0, at most 2 decimals.';
    else if (Number(length) > 10_000) found.lengthMetres = 'A roll is at most 10,000 m.';
    if (weight && (!/^\d+(\.\d{1,3})?$/.test(weight) || Number(weight) <= 0)) found.weightKg = 'Kg above 0, at most 3 decimals.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const { data } = await productionApi.recordRoll(run.id, { lengthMetres: Number(length), ...(weight ? { weightKg: Number(weight) } : {}) }, key);
      toast.success(`Roll ${data.roll.rollNumber} recorded (${formatNumber(data.roll.lengthMetres, 'm')}). It now waits for QC.`);
      onDone();
    } catch (error) {
      const fields = fieldErrorsOf(error);
      if (Object.keys(fields).length) setErrors(fields);
      else {
        toast.error(error, { title: 'Roll not recorded' });
        onDone();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Record a roll for ${run.runNumber}`}
      subtitle="The roll is linked to this run, its machine and the yarn lots issued to the order."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="roll-form" className="erp-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Record roll'}</button>
        </>
      }
    >
      <form id="roll-form" className="erp-form-grid two-col" onSubmit={onSubmit} noValidate>
        <Field label="Length (metres)" htmlFor="r-len" error={errors.lengthMetres} required>
          <input id="r-len" className="erp-input" inputMode="decimal" value={form.lengthMetres} onChange={update('lengthMetres')} disabled={busy} placeholder="100" />
        </Field>
        <Field label="Weight (kg, optional)" htmlFor="r-wt" error={errors.weightKg}>
          <input id="r-wt" className="erp-input" inputMode="decimal" value={form.weightKg} onChange={update('weightKg')} disabled={busy} />
        </Field>
      </form>
    </Modal>
  );
}

const ACTIONS = {
  start: { title: 'Start this run?', label: 'Start', success: 'Run started.', message: 'The machine starts producing. The order moves to "In production".' },
  pause: { title: 'Pause this run?', label: 'Pause', success: 'Run paused.', message: 'The machine pauses with the run.', reason: true },
  resume: { title: 'Resume this run?', label: 'Resume', success: 'Run resumed.', message: 'The machine starts producing again.' },
  complete: { title: 'Complete this run?', label: 'Complete run', success: 'Run completed.', message: 'The machine becomes available. If the order is fully produced it moves to "Production completed".' },
  cancel: { title: 'Cancel this run?', label: 'Cancel run', success: 'Run cancelled.', message: 'The machine is freed and the quantity can be planned again.', reason: true, danger: true },
};

export default function RunDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const detail = useApiQuery(() => productionApi.get(id), [id]);
  const [action, setAction] = useState(null); // { name, reason, key, busy, error }
  const [recording, setRecording] = useState(false);

  if (detail.error) {
    return (
      <div>
        <PageHeader title="Production run" breadcrumbs={[{ label: 'Production', to: '/production' }, { label: 'Not available' }]} />
        <ErrorState error={detail.error} onRetry={detail.error.status === 404 ? undefined : detail.reload} />
      </div>
    );
  }
  if (!detail.data) return <LoadingState label="Loading run…" />;

  const { run, rolls } = detail.data;
  const operate = can.runProduction(user.role);
  const producing = ['RUNNING', 'PAUSED'].includes(run.status);

  async function confirm() {
    const config = ACTIONS[action.name];
    const reason = (action.reason ?? '').trim();
    if (config.reason && reason.length < 5) return setAction({ ...action, error: 'Give a reason of at least 5 characters.' });
    setAction({ ...action, busy: true, error: null });
    try {
      await productionApi.act(run.id, action.name, config.reason ? { reason } : {}, action.key);
      toast.success(config.success);
    } catch (error) {
      toast.error(error, { title: `${config.label} failed` });
    }
    setAction(null);
    detail.reload();
  }

  const open = (name) => setAction({ name, reason: '', key: newIdempotencyKey() });
  return (
    <div>
      <PageHeader
        title={run.runNumber}
        subtitle={`${run.orderNumber} on ${run.machineCode} · target ${formatNumber(run.targetMetres, 'm')}`}
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Production', to: '/production' }, { label: run.runNumber }]}
        actions={
          operate && (
            <>
              {run.status === 'PLANNED' && <button type="button" className="erp-btn-primary" onClick={() => open('start')}><Play size={15} aria-hidden="true" /> Start</button>}
              {run.status === 'RUNNING' && <button type="button" className="erp-btn-outline" onClick={() => open('pause')}><Pause size={15} aria-hidden="true" /> Pause</button>}
              {run.status === 'PAUSED' && <button type="button" className="erp-btn-primary" onClick={() => open('resume')}><Play size={15} aria-hidden="true" /> Resume</button>}
              {producing && <button type="button" className="erp-btn-primary" onClick={() => setRecording(true)}><PlusCircle size={15} aria-hidden="true" /> Record roll</button>}
              {producing && (
                <button type="button" className="erp-btn-outline" onClick={() => open('complete')} disabled={run.rollCount === 0} title={run.rollCount === 0 ? 'Record at least one roll first.' : undefined}>
                  <CheckCircle2 size={15} aria-hidden="true" /> Complete
                </button>
              )}
              {run.status === 'PLANNED' && <button type="button" className="erp-btn-danger" onClick={() => open('cancel')}><XOctagon size={15} aria-hidden="true" /> Cancel run</button>}
            </>
          )
        }
      />

      <div className="erp-tall-kpi-grid">
        <div className="erp-card"><div className="detail-label">Status</div><div className="detail-value"><RunStatusBadge status={run.status} /></div></div>
        <div className="erp-card"><div className="detail-label">Produced</div><RunProgress run={run} /></div>
        <div className="erp-card"><div className="detail-label">Rolls</div><div className="detail-value">{run.rollCount}</div></div>
        <div className="erp-card">
          <div className="detail-label">Order · machine</div>
          <div className="detail-value"><Link to={`/orders/${run.orderId}`}>{run.orderNumber}</Link> · {can.operateMachines(user.role) || user.role === 'QC_INSPECTOR' ? <Link to={`/machines/${run.machineId}`}>{run.machineCode}</Link> : run.machineCode}</div>
        </div>
      </div>

      <div className="detail-columns">
        <div className="erp-card">
          <h3 className="card-title">Rolls</h3>
          <p className="card-subtitle">Each roll carries its order, run, machine and yarn lots. QC inspects them next.</p>
          {rolls.length === 0 ? (
            <EmptyState title="No rolls yet">{producing ? 'Record rolls as they come off the machine.' : 'Rolls are recorded while the run is producing.'}</EmptyState>
          ) : (
            <table className="erp-data-table">
              <thead><tr><th scope="col">Roll</th><th scope="col" className="num">Length</th><th scope="col" className="num">Weight</th><th scope="col">Yarn lots</th><th scope="col">Status</th><th scope="col">Recorded</th></tr></thead>
              <tbody>
                {rolls.map((r) => (
                  <tr key={r.id}>
                    <td className="mono"><Link to={`/rolls/${r.id}`}>{r.rollNumber}</Link></td>
                    <td className="num">{formatNumber(r.lengthMetres, 'm')}</td>
                    <td className="num">{r.weightKg !== null ? formatNumber(r.weightKg, 'kg') : '—'}</td>
                    <td>{r.yarnLots.map((lot) => lot.lotNumber).join(', ') || '—'}</td>
                    <td><span className="erp-status-badge outline">{ROLL_STATUS_LABELS[r.status] ?? r.status}</span></td>
                    <td>{formatDateTime(r.producedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="erp-card">
          <h3 className="card-title">Run history</h3>
          <ul className="status-history">
            {run.statusHistory.map((change, index) => (
              <li key={index} className="status-history-item">
                <span className="status-history-dot" aria-hidden="true">•</span>
                <div>
                  <div className="status-history-title">{change.from ? `${RUN_STATUS_LABELS[change.from]} → ` : ''}{RUN_STATUS_LABELS[change.to]}</div>
                  <div className="status-history-meta">{formatDateTime(change.at)} · {ROLE_LABELS[change.byRole] ?? change.byRole}</div>
                  {change.reason && <div className="status-history-reason">{change.reason}</div>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {recording && <RecordRollModal run={run} onClose={() => setRecording(false)} onDone={() => { setRecording(false); detail.reload(); }} />}
      {action && (
        <ConfirmDialog
          title={ACTIONS[action.name].title}
          message={ACTIONS[action.name].message}
          confirmLabel={ACTIONS[action.name].label}
          danger={ACTIONS[action.name].danger}
          busy={action.busy}
          reason={action.reason}
          reasonError={action.error}
          onReasonChange={ACTIONS[action.name].reason ? (reason) => setAction({ ...action, reason, error: null, key: newIdempotencyKey() }) : undefined}
          onConfirm={confirm}
          onClose={() => setAction(null)}
        />
      )}
    </div>
  );
}
