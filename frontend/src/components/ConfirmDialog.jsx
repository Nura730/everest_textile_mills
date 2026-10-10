import { useEffect } from 'react';
import { AlertTriangle, AlertOctagon, X } from 'lucide-react';

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  consequences,
  confirmLabel = 'Confirm Action',
  cancelLabel = 'Cancel',
  isDestructive = false,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="erp-modal-overlay"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div
        className="erp-modal-box confirm-dialog-box"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 460 }}
      >
        <div className="modal-header" style={{ alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className={`confirm-icon-box ${isDestructive ? 'destructive' : ''}`}>
              {isDestructive ? (
                <AlertOctagon size={20} className="text-red" />
              ) : (
                <AlertTriangle size={20} className="text-warning" />
              )}
            </div>
            <div>
              <h3 id="confirm-dialog-title" className="modal-title" style={{ fontSize: '1.0625rem' }}>
                {title}
              </h3>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onCancel} aria-label="Close dialog">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body" style={{ paddingTop: 8 }}>
          <p className="confirm-dialog-message" style={{ margin: '0 0 10px 0', fontSize: '0.875rem', color: 'var(--color-gray-800)', lineHeight: 1.5 }}>
            {message}
          </p>

          {consequences && (
            <div className="confirm-consequences-box">
              <span className="consequences-label">Important:</span>
              <p className="consequences-text">{consequences}</p>
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ gap: 10, justifyContent: 'flex-end' }}>
          <button type="button" className="erp-btn-outline" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={isDestructive ? 'erp-btn-danger' : 'erp-btn-primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
