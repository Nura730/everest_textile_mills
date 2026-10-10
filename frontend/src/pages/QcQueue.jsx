import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { newIdempotencyKey } from '../api/client.js';
import { qcApi, rollsApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { runOrQueue } from '../offline/syncManager.js';
import { CachedNotice } from '../offline/CachedNotice.jsx';
import { PendingActions } from '../offline/PendingActions.jsx';
import { liveMatch, useLive } from '../realtime/realtimeBus.js';
import { can } from '../auth/roles.js';
import { QcResultBadge } from '../components/machines/MachineStatus.jsx';
import { InspectRollModal } from '../components/quality/InspectRollModal.jsx';
import { ConfirmDialog } from '../components/ui/Modal.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, ListLimitNotice, LoadingState } from '../components/ui/States.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { formatDateTime, formatNumber } from '../utils/format.js';
import { DEFECT_LABELS } from '../utils/machineStatus.js';

function RollTable({ rolls, action }) {
  return (
    <table className="erp-data-table">
      <thead><tr><th scope="col">Roll</th><th scope="col">Order</th><th scope="col">Machine</th><th scope="col" className="num">Length</th><th scope="col" className="num">Attempt</th><th scope="col">Produced</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>
        {rolls.map((roll) => (
          <tr key={roll.id}>
            <td className="mono"><Link to={`/rolls/${roll.id}`}>{roll.rollNumber}</Link></td>
            <td>{roll.orderNumber}</td>
            <td>{roll.machineCode}</td>
            <td className="num">{formatNumber(roll.lengthMetres, 'm')}</td>
            <td className="num">{roll.reworkCount + 1}</td>
            <td>{formatDateTime(roll.producedAt)}</td>
            <td className="row-actions">{action(roll)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** QC work: the inspection queue (oldest first), rolls in rework, summary and recent results. */
export default function QcQueue() {
  const { user } = useAuth();
  const toast = useToast();
  const pending = useApiQuery(() => rollsApi.list({ status: 'QC_PENDING', limit: 100 }), [], { cacheKey: 'rolls:QC_PENDING' });
  const rework = useApiQuery(() => rollsApi.list({ status: 'IN_REWORK', limit: 100 }), [], { cacheKey: 'rolls:IN_REWORK' });
  const summary = useApiQuery(() => qcApi.summary(), []);
  const recent = useApiQuery(() => qcApi.inspections({ limit: 15 }), []);
  const [inspecting, setInspecting] = useState(null);
  const [reworking, setReworking] = useState(null); // { roll, key, busy }
  const reload = () => {
    pending.reload();
    rework.reload();
    summary.reload();
    recent.reload();
  };
  useLive(liveMatch.actions('ROLL_', 'QC_', 'RUN_'), reload);
  const s = summary.data;
  const count = (status) => s?.rolls[status]?.rolls ?? 0;
  const inspected = s ? Object.values(s.inspections).reduce((a, b) => a + b, 0) : 0;
  const rate = (result) => (inspected ? `${Math.round(((s.inspections[result] ?? 0) / inspected) * 100)}%` : '—');

  async function confirmRework() {
    setReworking({ ...reworking, busy: true });
    try {
      const sent = await runOrQueue(
        { key: reworking.key, type: 'REWORK_DONE', payload: { rollId: reworking.roll.id }, label: `Rework finished on ${reworking.roll.rollNumber}`, ref: { rollId: reworking.roll.id }, userId: user.id },
        (k) => rollsApi.reworkDone(reworking.roll.id, null, k),
      );
      if (sent.queued) toast.info('Saved on this device. It will be sent when the connection returns.', { title: 'Offline' });
      else toast.success(`Roll ${reworking.roll.rollNumber} is back in the QC queue.`);
    } catch (error) {
      toast.error(error, { title: 'Not returned to QC' });
    }
    setReworking(null);
    reload();
  }

  return (
    <div>
      <PageHeader
        title="Quality control"
        subtitle="Inspect rolls as they come off the machines. A pass is signed by the inspector. Live data."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Quality control' }]}
        actions={<button type="button" className="erp-btn-outline" onClick={reload} aria-label="Refresh"><RefreshCw size={15} aria-hidden="true" /> Refresh</button>}
      />
      <CachedNotice cachedAt={pending.cachedAt} />
      <PendingActions title="QC work saved on this device" match={(item) => item.type === 'QC_INSPECT' || item.type === 'REWORK_DONE'} onApplied={reload} />
      <div className="erp-tall-kpi-grid">
        <div className="erp-card"><div className="detail-label">Awaiting QC</div><div className="detail-value">{count('QC_PENDING')}</div></div>
        <div className="erp-card"><div className="detail-label">In rework</div><div className="detail-value">{count('IN_REWORK')}</div></div>
        <div className="erp-card"><div className="detail-label">Pass rate</div><div className="detail-value">{rate('PASS')}</div><div className="cell-sub">rework {rate('REWORK')} · reject {rate('REJECT')}</div></div>
        <div className="erp-card"><div className="detail-label">Rejected rolls</div><div className="detail-value">{count('REJECTED')}</div><div className="cell-sub">never become stock</div></div>
      </div>

      <div className="erp-card section-gap">
        <h3 className="card-title">Inspection queue</h3>
        <p className="card-subtitle">Oldest first.</p>
        {pending.error && <ErrorState error={pending.error} onRetry={pending.reload} />}
        {!pending.error && !pending.data && <LoadingState />}
        {pending.data && pending.data.rolls.length === 0 && <EmptyState title="No rolls awaiting inspection" />}
        {pending.data?.rolls.length > 0 && (
          <RollTable rolls={pending.data.rolls} action={(roll) => can.inspectRolls(user.role) && <button type="button" className="erp-btn-primary erp-btn-sm" onClick={() => setInspecting(roll)}>Inspect</button>} />
        )}
        <ListLimitNotice shown={pending.data?.rolls.length ?? 0} total={pending.meta?.total} />
      </div>

      <div className="erp-card section-gap">
        <h3 className="card-title">In rework</h3>
        <p className="card-subtitle">Back to QC once the floor has finished the rework.</p>
        {rework.data && rework.data.rolls.length === 0 && <EmptyState title="Nothing in rework" />}
        {rework.data?.rolls.length > 0 && (
          <RollTable rolls={rework.data.rolls} action={(roll) => can.finishRework(user.role) && <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setReworking({ roll, key: newIdempotencyKey(), busy: false })}>Rework done</button>} />
        )}
      </div>

      <div className="erp-card section-gap">
        <h3 className="card-title">Recent inspections</h3>
        {recent.data && recent.data.inspections.length === 0 && <EmptyState title="No inspections yet" />}
        {recent.data?.inspections.length > 0 && (
          <table className="erp-data-table">
            <thead><tr><th scope="col">When</th><th scope="col">Roll</th><th scope="col" className="num">Attempt</th><th scope="col">Result</th><th scope="col">Defects</th><th scope="col">Inspector</th></tr></thead>
            <tbody>
              {recent.data.inspections.map((i) => (
                <tr key={i.id}>
                  <td>{formatDateTime(i.inspectedAt)}</td>
                  <td className="mono"><Link to={`/rolls/${i.rollId}`}>{i.rollNumber}</Link></td>
                  <td className="num">{i.attempt}</td>
                  <td><QcResultBadge result={i.result} />{i.signatureId && <span className="cell-sub"> · signed</span>}</td>
                  <td>{i.defects.map((d) => DEFECT_LABELS[d.type] ?? d.type).join(', ') || '—'}</td>
                  <td>{i.inspectorName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {inspecting && <InspectRollModal roll={inspecting} onClose={() => setInspecting(null)} onDone={() => { setInspecting(null); reload(); }} />}
      {reworking && (
        <ConfirmDialog
          title={`Return ${reworking.roll.rollNumber} to QC?`}
          message="Confirm the rework is finished. The roll goes back to the inspection queue as its next attempt; earlier results stay in its history."
          confirmLabel="Rework done"
          busy={reworking.busy}
          onConfirm={confirmRework}
          onClose={() => setReworking(null)}
        />
      )}
    </div>
  );
}
