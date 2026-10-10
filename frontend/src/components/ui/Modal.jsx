import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/** Accessible modal: labelled dialog, Escape closes (unless busy), focus moves into it. */
export function Modal({ title, subtitle, onClose, busy = false, children, footer, wide = false }) {
  const boxRef = useRef(null);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    boxRef.current?.querySelector('input, select, textarea, button:not(.modal-close-btn)')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  return (
    <div className="erp-modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <div
        ref={boxRef}
        className="erp-modal-box"
        style={wide ? { maxWidth: 760 } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        <div className="modal-header">
          <div>
            <h3 className="modal-title" id="modal-title">{title}</h3>
            {subtitle && <p className="modal-subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} disabled={busy} aria-label="Close dialog">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/** Confirmation for consequential actions, optionally asking for a reason (cancel, reject, deactivate). */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  busy = false,
  reason,
  onReasonChange,
  reasonError,
  onConfirm,
  onClose,
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>
            Keep it
          </button>
          <button type="button" className={danger ? 'erp-btn-danger' : 'erp-btn-primary'} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      <p className="confirm-message">{message}</p>
      {onReasonChange && (
        <Field label="Reason" htmlFor="confirm-reason" error={reasonError} hint="5–500 characters. Recorded in the order history and audit log.">
          <textarea
            id="confirm-reason"
            className="erp-input"
            rows={3}
            value={reason}
            onChange={(event) => onReasonChange(event.target.value)}
            disabled={busy}
          />
        </Field>
      )}
    </Modal>
  );
}

/** Label + input + error message beside the input + optional hint. */
export function Field({ label, htmlFor, error, hint, required, children }) {
  return (
    <div className={`form-group ${error ? 'has-error' : ''}`}>
      <label className="erp-label" htmlFor={htmlFor}>
        {label}
        {required && <span className="field-required" aria-hidden="true"> *</span>}
      </label>
      {children}
      {error ? (
        <div className="form-error-msg" role="alert" id={`${htmlFor}-error`}>
          {error}
        </div>
      ) : (
        hint && <div className="field-hint">{hint}</div>
      )}
    </div>
  );
}
