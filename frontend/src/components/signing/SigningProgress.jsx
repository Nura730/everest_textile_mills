import { AlertTriangle, CheckCircle2, Circle, CircleDashed, CloudOff, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { useState } from 'react';
import { signaturesApi } from '../../api/endpoints.js';
import { ROLE_LABELS } from '../../auth/roles.js';
import { formatDateTime } from '../../utils/format.js';
import { canRetry, failureSummary } from './signingStages.js';

const ICONS = {
  done: { Icon: CheckCircle2, text: 'Done', tone: 'ok' },
  failed: { Icon: XCircle, text: 'Failed', tone: 'bad' },
  pending: { Icon: Circle, text: 'Pending', tone: 'idle' },
  skipped: { Icon: CircleDashed, text: 'Not run', tone: 'idle' },
  unknown: { Icon: AlertTriangle, text: 'Not reported', tone: 'warn' },
};

function StageList({ stages, running }) {
  return (
    <ol className="sign-stages" aria-label="Signing steps">
      {stages.map((s) => {
        const { Icon, text, tone } = ICONS[s.status] ?? ICONS.pending;
        return (
          <li key={s.stage} className={`sign-stage ${tone}`}>
            <Icon size={16} aria-hidden="true" />
            <div>
              <div className="sign-stage-label">{s.label} <span className="sr-only">— {running && s.status === 'pending' ? 'waiting for the server' : text}</span></div>
              {s.detail && <div className="cell-sub">{s.detail}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function VerificationDetails({ signatureId }) {
  const [state, setState] = useState({ loading: false, data: null, error: null });
  async function load() {
    setState({ loading: true, data: null, error: null });
    try {
      const { data } = await signaturesApi.verify(signatureId);
      setState({ loading: false, data: data.verification, error: null });
    } catch (error) {
      setState({ loading: false, data: null, error });
    }
  }
  if (!state.data) {
    return (
      <button type="button" className="erp-btn-outline erp-btn-sm" onClick={load} disabled={state.loading}>
        {state.loading ? 'Verifying again…' : 'View verification details'}
      </button>
    );
  }
  const v = state.data;
  return (
    <div className="sign-details">
      <div className={`sign-verdict ${v.valid ? 'ok' : 'bad'}`}>{v.valid ? 'Independent check: all checks passed' : 'Independent check: verification failed'}</div>
      <ul className="plain-list">
        {v.checks.map((c) => <li key={c.check}>{c.ok ? '✓' : '✗'} {c.detail}</li>)}
      </ul>
      <dl className="sign-meta">
        <dt>Algorithm</dt><dd>{v.signature.algorithm ?? '—'}</dd>
        <dt>Key id</dt><dd><code>{v.signature.keyId ?? '—'}</code></dd>
        <dt>Payload SHA-256</dt><dd><code className="wrap-anywhere">{v.signature.payloadHash}</code></dd>
        <dt>Statement</dt><dd>{v.signature.statement}</dd>
        {v.key && <><dt>Key status</dt><dd>{v.key.status} · RSA {v.key.modulusBits}-bit</dd></>}
      </dl>
      {state.error && <p className="login-field-error">{state.error.message}</p>}
    </div>
  );
}

/**
 * The signing progress view used by QC and dispatch approvals. It shows only what the server reported:
 * the approval is created, signed, verified and saved in one request, so stages stay "pending" until the
 * server answers, then each takes the status the answer proves.
 */
export function SigningProgress({ signer, approvalLabel, recordLabel, phase, stages, result, error, onRetry, onCheckAgain, onKeepOffline, onBack }) {
  const signature = result?.signature;
  return (
    <div className="sign-progress" aria-live="polite">
      <div className="sign-head">
        <ShieldCheck size={18} aria-hidden="true" />
        <div>
          <strong>{approvalLabel}</strong>
          <div className="cell-sub">{recordLabel} · signer {signer.name} ({ROLE_LABELS[signer.role]})</div>
        </div>
      </div>

      {phase === 'submitting' && (
        <p className="sign-status running"><Loader2 size={15} className="spin" aria-hidden="true" /> The server is authenticating, checking permission, signing with your key and verifying — in one step. Please wait.</p>
      )}
      {phase === 'checking' && (
        <p className="sign-status warn"><Loader2 size={15} className="spin" aria-hidden="true" /> Result unconfirmed — checking server status…</p>
      )}
      {phase === 'unconfirmed' && (
        <div className="sign-status warn" role="alert">
          <AlertTriangle size={15} aria-hidden="true" /> Result unconfirmed — the connection dropped before the server answered. Checking again cannot approve twice.
        </div>
      )}
      {phase === 'queued' && (
        <div className="sign-status warn" role="status">
          <CloudOff size={15} aria-hidden="true" /> Saved offline — waiting to sync. The server will sign and verify the approval when it receives it; it is not approved yet.
        </div>
      )}
      {phase === 'failed' && (
        <div className="sign-status bad" role="alert">
          <XCircle size={15} aria-hidden="true" /> {error?.code === 'SIGNATURE_VERIFICATION_FAILED' ? 'Signature verification failed — approval not confirmed.' : `Not approved. ${failureSummary(error)}`}
        </div>
      )}
      {phase === 'success' && signature && (
        <div className="sign-status ok" role="status">
          <CheckCircle2 size={15} aria-hidden="true" /> Cryptographic signature verified.
        </div>
      )}

      {phase !== 'queued' && <StageList stages={stages} running={phase === 'submitting' || phase === 'checking'} />}

      {phase === 'success' && signature && (
        <>
          <dl className="sign-meta">
            <dt>Signed by</dt><dd>{signature.signerName} ({ROLE_LABELS[signature.signerRole] ?? signature.signerRole})</dd>
            <dt>Approval</dt><dd>{approvalLabel}</dd>
            <dt>Record</dt><dd>{recordLabel}</dd>
            <dt>Signed at</dt><dd>{formatDateTime(signature.signedAt)}</dd>
            <dt>Algorithm · key</dt><dd>{signature.algorithm} · <code>{signature.keyId}</code></dd>
            <dt>Handwritten acknowledgment</dt><dd>{signature.hasHandwrittenAcknowledgment ? 'Attached (visual evidence only)' : 'None'}</dd>
          </dl>
          <VerificationDetails signatureId={signature.id} />
        </>
      )}

      <div className="sign-actions">
        {phase === 'failed' && canRetry(error) && <button type="button" className="erp-btn-primary" onClick={onRetry}>Retry safely</button>}
        {phase === 'failed' && !canRetry(error) && onBack && <button type="button" className="erp-btn-outline" onClick={onBack}>Back to the form</button>}
        {phase === 'unconfirmed' && (
          <>
            <button type="button" className="erp-btn-primary" onClick={onCheckAgain}>Check again</button>
            {onKeepOffline && <button type="button" className="erp-btn-outline" onClick={onKeepOffline}>Keep on this device and sync later</button>}
          </>
        )}
      </div>
    </div>
  );
}
