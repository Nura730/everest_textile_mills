import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { fieldErrorsOf, newIdempotencyKey } from '../../api/client.js';
import { rollsApi } from '../../api/endpoints.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { runOrQueue } from '../../offline/syncManager.js';
import { formatNumber } from '../../utils/format.js';
import { DEFECT_LABELS, QC_RESULT_LABELS } from '../../utils/machineStatus.js';
import { Field, Modal } from '../ui/Modal.jsx';
import { SignaturePad } from '../ui/SignaturePad.jsx';
import { useToast } from '../ui/Toast.jsx';

const SEVERITIES = ['MINOR', 'MAJOR', 'CRITICAL'];
const titleCase = (v) => v.charAt(0) + v.slice(1).toLowerCase();

/**
 * Inspect one roll. PASS asks the inspector to accept the statement and sign (instruction.md §11);
 * REWORK and REJECT need at least one defect. The server enforces all of it again.
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
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const touch = () => {
    setError(null);
    setKey(newIdempotencyKey());
  };
  const statement = `I confirm that roll ${roll.rollNumber} has passed inspection.`;

  const setDefect = (index, field, value) => {
    setDefects((current) => current.map((d, i) => (i === index ? { ...d, [field]: value } : d)));
    touch();
  };

  async function submit() {
    if (busy) return;
    if (result !== 'PASS' && defects.length === 0) return setError(`Record at least one defect for ${QC_RESULT_LABELS[result].toLowerCase()}.`);
    if (result === 'PASS' && (!accepted || !image)) return setError('Tick the statement and sign to pass the roll.');
    const body = {
      result,
      defects: defects.map((d) => ({ type: d.type, severity: d.severity, ...(d.notes.trim() ? { notes: d.notes.trim() } : {}) })),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      ...(result === 'PASS' ? { signature: { accepted: true, image } } : {}),
    };
    setBusy(true);
    try {
      const sent = await runOrQueue(
        { key, type: 'QC_INSPECT', payload: { rollId: roll.id, ...body }, label: `QC ${result.toLowerCase()} for ${roll.rollNumber}`, userId: user.id },
        (k) => rollsApi.inspect(roll.id, body, k),
      );
      if (sent.queued) {
        toast.info('Saved on this device. It will be sent when the connection returns.', { title: 'Offline' });
        onDone();
        return;
      }
      toast.success(
        result === 'PASS' ? `Roll ${roll.rollNumber} passed and signed.` : result === 'REWORK' ? `Roll ${roll.rollNumber} sent to rework.` : `Roll ${roll.rollNumber} rejected. It can never become stock.`,
      );
      onDone();
    } catch (err) {
      const fields = fieldErrorsOf(err);
      if (Object.keys(fields).length) setError(Object.values(fields)[0]);
      else {
        toast.error(err, { title: 'Inspection not saved' });
        if (err.code === 'INVALID_STATE_TRANSITION' || err.code === 'CONFLICT') onDone();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Inspect ${roll.rollNumber}`}
      subtitle={`${formatNumber(roll.lengthMetres, 'm')} · order ${roll.orderNumber} · machine ${roll.machineCode} · run ${roll.runNumber}`}
      onClose={onClose}
      busy={busy}
      wide
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className={result === 'REJECT' ? 'erp-btn-danger' : 'erp-btn-primary'} onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : result === 'PASS' ? 'Sign and pass' : result === 'REWORK' ? 'Send to rework' : 'Reject roll'}
          </button>
        </>
      }
    >
      <div className="erp-form-grid">
        <div className="erp-tabs-bar" role="radiogroup" aria-label="Result">
          {Object.entries(QC_RESULT_LABELS).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={result === value} className={`erp-tab-btn ${result === value ? 'active' : ''}`} onClick={() => { setResult(value); touch(); }} disabled={busy}>
              {label}
            </button>
          ))}
        </div>

        <div>
          <div className="card-header">
            <span className="erp-label">Defects {result !== 'PASS' && '(at least one)'}</span>
            <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => { setDefects([...defects, { type: 'COLOUR_MISMATCH', severity: 'MAJOR', notes: '' }]); touch(); }} disabled={busy || defects.length >= 20}>
              <Plus size={13} aria-hidden="true" /> Add defect
            </button>
          </div>
          {defects.length === 0 && <p className="cell-sub">No defects recorded.</p>}
          {defects.map((defect, index) => (
            <div key={index} className="defect-row">
              <select className="erp-input" aria-label="Defect type" value={defect.type} onChange={(e) => setDefect(index, 'type', e.target.value)} disabled={busy}>
                {Object.entries(DEFECT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <select className="erp-input" aria-label="Severity" value={defect.severity} onChange={(e) => setDefect(index, 'severity', e.target.value)} disabled={busy}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
              </select>
              <input className="erp-input" aria-label="Defect notes" placeholder="Notes (optional)" value={defect.notes} maxLength={500} onChange={(e) => setDefect(index, 'notes', e.target.value)} disabled={busy} />
              <button type="button" className="erp-btn-outline erp-btn-sm" aria-label="Remove defect" onClick={() => { setDefects(defects.filter((_, i) => i !== index)); touch(); }} disabled={busy}>
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>

        <Field label="Notes (optional)" htmlFor="qc-notes">
          <textarea id="qc-notes" className="erp-input" rows={2} maxLength={1000} value={notes} onChange={(e) => { setNotes(e.target.value); touch(); }} disabled={busy} />
        </Field>

        {result === 'PASS' && (
          <div className="signature-block">
            <label className="filter-check" htmlFor="qc-accept">
              <input id="qc-accept" type="checkbox" checked={accepted} onChange={(e) => { setAccepted(e.target.checked); touch(); }} disabled={busy} /> {statement}
            </label>
            <SignaturePad onChange={(value) => { setImage(value); touch(); }} disabled={busy} label="Inspector signature" />
          </div>
        )}
        {error && <p className="login-field-error" role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
