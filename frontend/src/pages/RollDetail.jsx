import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { newIdempotencyKey } from '../api/client.js';
import { rollsApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { runOrQueue } from '../offline/syncManager.js';
import { liveMatch, useLive } from '../realtime/realtimeBus.js';
import { can } from '../auth/roles.js';
import { QcResultBadge, RollStatusBadge } from '../components/machines/MachineStatus.jsx';
import { InspectRollModal } from '../components/quality/InspectRollModal.jsx';
import { ConfirmDialog } from '../components/ui/Modal.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { formatDate, formatDateTime, formatNumber } from '../utils/format.js';
import { DEFECT_LABELS } from '../utils/machineStatus.js';

function Fact({ label, children }) {
  return (
    <div className="detail-item">
      <div className="detail-label">{label}</div>
      <div className="detail-value">{children}</div>
    </div>
  );
}

/** The roll's full trace: order, run, machine, yarn lots, and every QC attempt with the signed pass. */
export default function RollDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const trace = useApiQuery(() => rollsApi.trace(id), [id]);
  useLive(liveMatch.entity(id), trace.reload);
  const [inspecting, setInspecting] = useState(false);
  const [reworking, setReworking] = useState(null);

  if (trace.error) {
    return (
      <div>
        <PageHeader title="Roll" breadcrumbs={[{ label: 'Rolls', to: '/rolls' }, { label: 'Not available' }]} />
        <ErrorState error={trace.error} onRetry={trace.error.status === 404 ? undefined : trace.reload} />
      </div>
    );
  }
  if (!trace.data) return <LoadingState label="Tracing roll…" />;
  const { roll, order, run, machine, yarnLots, inspections, qcSignature } = trace.data;
  const machineLink = can.operateMachines(user.role) || user.role === 'QC_INSPECTOR';

  async function confirmRework() {
    setReworking({ ...reworking, busy: true });
    try {
      const sent = await runOrQueue(
        { key: reworking.key, type: 'REWORK_DONE', payload: { rollId: roll.id }, label: `Rework finished on ${roll.rollNumber}`, userId: user.id },
        (k) => rollsApi.reworkDone(roll.id, null, k),
      );
      if (sent.queued) toast.info('Saved on this device. It will be sent when the connection returns.', { title: 'Offline' });
      else toast.success(`Roll ${roll.rollNumber} is back in the QC queue.`);
    } catch (error) {
      toast.error(error, { title: 'Not returned to QC' });
    }
    setReworking(null);
    trace.reload();
  }

  return (
    <div>
      <PageHeader
        title={roll.rollNumber}
        subtitle={`${formatNumber(roll.lengthMetres, 'm')}${roll.weightKg !== null ? ` · ${formatNumber(roll.weightKg, 'kg')}` : ''} · produced ${formatDateTime(roll.producedAt)}`}
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Rolls', to: '/rolls' }, { label: roll.rollNumber }]}
        actions={
          <>
            {roll.status === 'QC_PENDING' && can.inspectRolls(user.role) && <button type="button" className="erp-btn-primary" onClick={() => setInspecting(true)}>Inspect</button>}
            {roll.status === 'IN_REWORK' && can.finishRework(user.role) && <button type="button" className="erp-btn-outline" onClick={() => setReworking({ key: newIdempotencyKey(), busy: false })}>Rework done</button>}
          </>
        }
      />

      <div className="detail-columns">
        <div className="erp-card">
          <h3 className="card-title">Trace</h3>
          <p className="card-subtitle">Which order produced this roll, on which machine, when and from which yarn.</p>
          <div className="detail-grid">
            <Fact label="Status"><RollStatusBadge status={roll.status} /></Fact>
            <Fact label="Order">{order ? <Link to={`/orders/${order.id}`}>{order.orderNumber}</Link> : roll.orderNumber}{order && <span className="cell-sub"> · {order.buyer.name}</span>}</Fact>
            <Fact label="Fabric">{order ? `${order.product.name} (${order.product.material} · ${order.product.colour})` : '—'}</Fact>
            <Fact label="Production run">{run ? <Link to={`/production/${run.id}`}>{run.runNumber}</Link> : roll.runNumber}</Fact>
            <Fact label="Machine">{machine && machineLink ? <Link to={`/machines/${machine.id}`}>{machine.code} · {machine.name}</Link> : roll.machineCode}</Fact>
            <Fact label="Produced">{formatDateTime(roll.producedAt)}</Fact>
            <Fact label="Length">{formatNumber(roll.lengthMetres, 'm')}</Fact>
            <Fact label="Rework rounds">{roll.reworkCount}</Fact>
          </div>
          <h4 className="card-title section-gap">Yarn lots</h4>
          {yarnLots.length === 0 ? <p className="cell-sub">No yarn lots recorded.</p> : (
            <table className="erp-data-table">
              <thead><tr><th scope="col">Lot</th><th scope="col">Material · colour</th><th scope="col">Supplier</th><th scope="col">Received</th><th scope="col" className="num">Issued to order</th></tr></thead>
              <tbody>
                {yarnLots.map((lot) => (
                  <tr key={lot.id}><td className="mono">{lot.lotNumber}</td><td>{lot.material} · {lot.colour}</td><td>{lot.supplierName}</td><td>{formatDate(lot.receivedAt)}</td><td className="num">{formatNumber(lot.issuedToOrderKg, 'kg')}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="erp-card">
          <h3 className="card-title">QC history</h3>
          <p className="card-subtitle">Every attempt is kept; a reworked roll never disappears from history.</p>
          {inspections.length === 0 ? <EmptyState title="Not inspected yet" /> : (
            <ul className="status-history">
              {inspections.map((i) => (
                <li key={i.id} className="status-history-item">
                  <span className="status-history-dot" aria-hidden="true">{i.attempt}</span>
                  <div>
                    <div className="status-history-title"><QcResultBadge result={i.result} /> attempt {i.attempt}</div>
                    <div className="status-history-meta">{formatDateTime(i.inspectedAt)} · {i.inspectorName}</div>
                    {i.defects.length > 0 && <div className="status-history-reason">{i.defects.map((d) => `${DEFECT_LABELS[d.type] ?? d.type} (${d.severity.toLowerCase()})${d.notes ? `: ${d.notes}` : ''}`).join('; ')}</div>}
                    {i.notes && <div className="status-history-reason">{i.notes}</div>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {qcSignature && (
            <div className="signature-record">
              <div className="detail-label">Signed pass</div>
              <p className="confirm-message">“{qcSignature.statement}”</p>
              {qcSignature.signatureImage && <img src={qcSignature.signatureImage} alt={`Signature of ${qcSignature.signerName}`} className="signature-image" />}
              <div className="cell-sub">{qcSignature.signerName} · {formatDateTime(qcSignature.signedAt)}</div>
              <div className="cell-sub mono">SHA-256 {qcSignature.contentHash.slice(0, 16)}…</div>
            </div>
          )}
        </div>
      </div>

      {inspecting && <InspectRollModal roll={roll} onClose={() => setInspecting(false)} onDone={() => { setInspecting(false); trace.reload(); }} />}
      {reworking && (
        <ConfirmDialog
          title={`Return ${roll.rollNumber} to QC?`}
          message="Confirm the rework is finished. The roll goes back to the inspection queue as its next attempt."
          confirmLabel="Rework done"
          busy={reworking.busy}
          onConfirm={confirmRework}
          onClose={() => setReworking(null)}
        />
      )}
    </div>
  );
}
