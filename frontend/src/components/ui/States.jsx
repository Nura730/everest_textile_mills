import { AlertTriangle, Inbox, Loader2, WifiOff } from 'lucide-react';

export function LoadingState({ label = 'Loading…', fullPage = false }) {
  const content = (
    <div className="state-inline" role="status" aria-live="polite">
      <Loader2 size={18} className="spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
  return fullPage ? <div className="full-page-center">{content}</div> : content;
}

/** Said whenever a list shows fewer rows than exist, so a cut-off list is never mistaken for all of it. */
export function ListLimitNotice({ shown, total }) {
  if (total === undefined || total === null || shown >= total) return null;
  return (
    <p className="list-limit-notice" role="note">
      Showing the first {shown.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}.
    </p>
  );
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="state-box">
      <Inbox size={26} aria-hidden="true" />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

/** Shows the real error message from the API (never a stack trace) and a retry. */
export function ErrorState({ error, onRetry }) {
  const network = error?.isNetworkError;
  const Icon = network ? WifiOff : AlertTriangle;
  return (
    <div className="state-box state-error" role="alert">
      <Icon size={26} aria-hidden="true" />
      <h3>{network ? 'Cannot reach the server' : 'Could not load this data'}</h3>
      <p>{error?.message ?? 'Unexpected error.'}</p>
      {error?.requestId && <p className="state-ref">Reference: {error.requestId}</p>}
      {onRetry && (
        <button type="button" className="erp-btn-outline" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
