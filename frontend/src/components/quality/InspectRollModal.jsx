import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { rollsApi } from '../../api/endpoints.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { formatNumber } from '../../utils/format.js';
import { DEFECT_LABELS, QC_RESULT_LABELS } from '../../utils/machineStatus.js';
import { SigningProgress } from '../signing/SigningProgress.jsx';
import { useSignedSubmit } from '../signing/useSignedSubmit.js';
import { Field, Modal } from '../ui/Modal.jsx';
import { SignaturePad } from '../ui/SignaturePad.jsx';
import { useToast } from '../ui/Toast.jsx';

const SEVERITIES = ['MINOR', 'MAJOR', 'CRITICAL'];
const titleCase = (v) => v.charAt(0) + v.slice(1).toLowerCase();
const STATEMENT = {
  PASS: (n) => `I confirm that roll ${n} has passed inspection.`,
  REWORK: (n) => `I confirm that roll ${n} needs rework for the defects recorded.`,
  REJECT: (n) => `I confirm that roll ${n} is rejected for the defects recorded.`,
};

/**
 * Inspect one roll. Every decision (pass, rework, reject) is an approval: the inspector accepts the
 * statement and the server signs the inspection record with the inspector's own RSA key, verifying it
 * before saving. A drawn signature is an optional handwritten acknowledgment. The server enforces all
 * of it again; the progress view shows only what the server reported.
 */
export function InspectRollModal({ roll, onClose, onDone }) {
  const toast = useToast();
  const { user } = useAuth();
  const [result, setResult] = useState('PASS');
  const [defects, setDefects] = useState([]);
  const [notes, setNotes] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [image, setImage] = useState(null);
  const [error, setError] = useState(null);
  const statement = STATEMENT[result](roll.rollNumber);

  const body = useMemo(
    () => ({
      result,
      defects: defects.map((d) => ({ type: d.type, severity: d.severity, ...(d.notes.trim() ? { notes: d.notes.trim() } : {}) })),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      signature: { accepted: true, ...(image ? { image } : {}) },
    }),
    [result, defects, notes, image],
  );
  const signed = useSignedSubmit({
    call: (k) => rollsApi.inspect(roll.id, body, k),
    offline: { type: 'QC_INSPECT', payload: { rollId: roll.id, ...body }, label: `QC ${result.toLowerCase()} for ${roll.rollNumber}`, ref: { rollId: roll.id }, userId: user.id },
  });
  const touch = () => {
    setError(null);
    signed.reset(); // a changed decision is a new approval with a new key
  };
  const setDefect = (index, field, value) => {
    setDefects((current) => current.map((d, i) => (i === index ? { ...d, [field]: value } : d)));
    touch();
  };

  function submit() {
    if (signed.busy) return;
    if (result !== 'PASS' && defects.length === 0) return setError(`Record at least one defect for ${QC_RESULT_LABELS[result].toLowerCase()}.`);
    if (!accepted) return setError('Tick the statement to sign this decision.');
    signed.submit();
  }

  function finish() {
    if (signed.phase === 'success') {
      toast.success(
        result === 'PASS' ? `Roll ${roll.rollNumber} passed. Signature verified on the server.` : result === 'REWORK' ? `Roll ${roll.rollNumber} sent to rework. Signature verified on the server.` : `Roll ${roll.rollNumber} rejected. Signature verified on the server.`,
        { title: 'Inspection saved' },
      );
    }
    if (signed.phase === 'queued') toast.info('Saved offline — waiting to sync. The server signs it when it arrives.', { title: 'Saved on this device' });
    onDone();
  }

  const signing = signed.phase !== 'idle';
  const closeable = !signed.busy;
  return (
    <Modal
      title={`Inspect ${roll.rollNumber}`}
      subtitle={`${formatNumber(roll.lengthMetres, 'm')} · order ${roll.orderNumber} · machine ${roll.machineCode} · run ${roll.runNumber}`}
      onClose={signing && ['success', 'queued'].includes(signed.phase) ? finish : onClose}
      busy={!closeable}
      wide
      footer={
        signing ? (
          <button type="button" className="erp-btn-primary" onClick={signed.phase === 'success' || signed.phase === 'queued' ? finish : onClose} disabled={!closeable}>
            {signed.phase === 'success' || signed.phase === 'queued' ? 'Done' : 'Close'}
          </button>
        ) : (
          <>
            <button type="button" className="erp-btn-outline" onClick={onClose}>Cancel</button>
            <button type="button" className={result === 'REJECT' ? 'erp-btn-danger' : 'erp-btn-primary'} onClick={submit}>
              {result === 'PASS' ? 'Sign and pass' : result === 'REWORK' ? 'Sign and send to rework' : 'Sign and reject'}
            </button>
          </>
        )
      }
    >
      {signing ? (
        <SigningProgress
          signer={user}
          approvalLabel={`QC ${QC_RESULT_LABELS[result].toLowerCase()}`}
          recordLabel={`Roll ${roll.rollNumber}`}
          phase={signed.phase}
          stages={signed.stages}
          result={signed.result}
          error={signed.error}
          onRetry={signed.retry}
          onCheckAgain={signed.checkAgain}
          onKeepOffline={signed.keepOffline}
          onBack={signed.reset}
        />
      ) : (
        <div className="erp-form-grid">
          <div className="erp-tabs-bar" role="radiogroup" aria-label="Result">
            {Object.entries(QC_RESULT_LABELS).map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={result === value} className={`erp-tab-btn ${result === value ? 'active' : ''}`} onClick={() => { setResult(value); setAccepted(false); touch(); }}>
                {label}
              </button>
            ))}
          </div>

          <div>
            <div className="card-header">
              <span className="erp-label">Defects {result !== 'PASS' && '(at least one)'}</span>
              <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => { setDefects([...defects, { type: 'COLOUR_MISMATCH', severity: 'MAJOR', notes: '' }]); touch(); }} disabled={defects.length >= 20}>
                <Plus size={13} aria-hidden="true" /> Add defect
              </button>
            </div>
            {defects.length === 0 && <p className="cell-sub">No defects recorded.</p>}
            {defects.map((defect, index) => (
              <div key={index} className="defect-row">
                <select className="erp-input" aria-label="Defect type" value={defect.type} onChange={(e) => setDefect(index, 'type', e.target.value)}>
                  {Object.entries(DEFECT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <select className="erp-input" aria-label="Severity" value={defect.severity} onChange={(e) => setDefect(index, 'severity', e.target.value)}>
                  {SEVERITIES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                </select>
                <input className="erp-input" aria-label="Defect notes" placeholder="Notes (optional)" value={defect.notes} maxLength={500} onChange={(e) => setDefect(index, 'notes', e.target.value)} />
                <button type="button" className="erp-btn-outline erp-btn-sm" aria-label="Remove defect" onClick={() => { setDefects(defects.filter((_, i) => i !== index)); touch(); }}>
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>

          <Field label="Notes (optional)" htmlFor="qc-notes">
            <textarea id="qc-notes" className="erp-input" rows={2} maxLength={1000} value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} />
          </Field>

          <div className="signature-block">
            <div className="erp-label">Signed approval</div>
            <label className="filter-check" htmlFor="qc-accept">
              <input id="qc-accept" type="checkbox" checked={accepted} onChange={(e) => { setAccepted(e.target.checked); touch(); }} /> {statement}
            </label>
            <p className="cell-sub">The server signs this decision with your personal RSA key and verifies it before saving.</p>
            <SignaturePad onChange={(value) => { setImage(value); touch(); }} label="Handwritten acknowledgment (optional, visual only)" />
          </div>
          {error && <p className="login-field-error" role="alert">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
