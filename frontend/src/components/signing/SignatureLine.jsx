import { useState } from 'react';
import { signaturesApi } from '../../api/endpoints.js';
import { StatusBadge } from '../ui/StatusBadge.jsx';

/**
 * How one approval was signed, in precise words: "Cryptographically signed" (RSA-PSS with the signer's
 * key) or "Handwritten acknowledgment only" (records from before cryptographic signing). "Verify" asks
 * the server to re-check the signature against the record as stored now.
 */
export function SignatureLine({ signature }) {
  const [check, setCheck] = useState({ busy: false, result: null, error: null });
  if (!signature) return null;
  async function verify() {
    setCheck({ busy: true, result: null, error: null });
    try {
      const { data } = await signaturesApi.verify(signature.id);
      setCheck({ busy: false, result: data.verification, error: null });
    } catch (error) {
      setCheck({ busy: false, result: null, error });
    }
  }
  const v = check.result;
  return (
    <div className="signature-line">
      {signature.cryptographic ? (
        <StatusBadge tone="info" label="Cryptographically signed" title={`${signature.algorithm} · key ${signature.keyId}`} />
      ) : (
        <StatusBadge tone="neutral" label="Handwritten acknowledgment only" title="Recorded before cryptographic signing" />
      )}
      {signature.hasHandwrittenAcknowledgment && signature.cryptographic && <span className="cell-sub">+ handwritten acknowledgment</span>}
      {signature.cryptographic && !v && (
        <button type="button" className="erp-btn-outline erp-btn-sm" onClick={verify} disabled={check.busy}>{check.busy ? 'Verifying…' : 'Verify'}</button>
      )}
      {v && (
        <StatusBadge
          tone={v.valid ? 'success' : 'danger'}
          label={v.valid ? 'Verified now' : 'Verification failed'}
          title={v.checks.map((c) => `${c.ok ? '✓' : '✗'} ${c.detail}`).join('\n')}
        />
      )}
      {check.error && <span className="login-field-error">{check.error.message}</span>}
    </div>
  );
}
