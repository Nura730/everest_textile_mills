import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';
import { useApp } from '../context/AppContext';

export default function ToastContainer() {
  const { toasts, removeToast } = useApp();

  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="erp-toast-container" aria-live="polite" role="region" aria-label="Notifications">
      {toasts.map((toast) => {
        let Icon = Info;
        let iconClass = 'toast-icon-info';
        if (toast.type === 'success') {
          Icon = CheckCircle2;
          iconClass = 'toast-icon-success';
        } else if (toast.type === 'warning') {
          Icon = AlertTriangle;
          iconClass = 'toast-icon-warning';
        } else if (toast.type === 'error') {
          Icon = AlertCircle;
          iconClass = 'toast-icon-error';
        }

        return (
          <div
            key={toast.id}
            className={`erp-toast-item toast-${toast.type || 'info'}`}
            role="status"
          >
            <div className={`erp-toast-icon-box ${iconClass}`}>
              <Icon size={18} />
            </div>
            <div className="erp-toast-content">
              {toast.title && <div className="erp-toast-title">{toast.title}</div>}
              <div className="erp-toast-message">{toast.message}</div>
            </div>
            <button
              type="button"
              className="erp-toast-close-btn"
              onClick={() => removeToast(toast.id)}
              aria-label="Dismiss notification"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
