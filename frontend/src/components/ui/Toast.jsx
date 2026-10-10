import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, WifiOff, X, XCircle } from 'lucide-react';
import { ApiError } from '../../api/client.js';

const ToastContext = createContext(null);

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  network: WifiOff,
  loading: Loader2,
};

// Errors stay until dismissed (the user may need the reference); everything else fades.
const DURATION = { success: 4500, info: 4500, warning: 7000, loading: null, error: null, network: null };

let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (type, message, { title, reference, duration } = {}) => {
      const id = nextId++;
      setToasts((current) => [...current.slice(-4), { id, type, title, message, reference }]);
      const ms = duration === undefined ? DURATION[type] : duration;
      if (ms) timers.current.set(id, setTimeout(() => dismiss(id), ms));
      return id;
    },
    [dismiss],
  );

  const api = useMemo(
    () => ({
      success: (message, options) => show('success', message, options),
      info: (message, options) => show('info', message, options),
      warning: (message, options) => show('warning', message, options),
      loading: (message, options) => show('loading', message, options),
      dismiss,
      /** Turns any thrown error into a readable toast. Never shows stack traces. */
      error: (error, { title } = {}) => {
        if (error instanceof ApiError) {
          if (error.isNetworkError) return show('network', error.message, { title: title ?? 'Connection problem' });
          return show('error', error.message, { title: title ?? 'Action failed', reference: error.requestId });
        }
        return show('error', typeof error === 'string' ? error : 'Something went wrong.', { title: title ?? 'Action failed' });
      },
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* aria-live: screen readers announce new notifications without moving focus. */}
      <div className="toast-region" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((toast) => {
          const Icon = ICONS[toast.type];
          return (
            <div key={toast.id} className={`toast toast-${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}>
              <Icon size={18} className={`toast-icon ${toast.type === 'loading' ? 'spin' : ''}`} aria-hidden="true" />
              <div className="toast-body">
                {toast.title && <div className="toast-title">{toast.title}</div>}
                <div className="toast-message">{toast.message}</div>
                {toast.reference && <div className="toast-ref">Reference: {toast.reference}</div>}
              </div>
              <button type="button" className="toast-close" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">
                <X size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

// eslint-disable-next-line react/only-export-components
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
