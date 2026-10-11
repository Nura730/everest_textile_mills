import { CloudOff } from 'lucide-react';
import { formatDateTime } from '../utils/format.js';

/** Shown above data that came from this device's cache, not from the server. */
export function CachedNotice({ cachedAt }) {
  if (!cachedAt) return null;
  return (
    <div className="cached-notice" role="status">
      <CloudOff size={15} aria-hidden="true" />
      <span>
        <strong>Offline.</strong> Showing what this device saved at {formatDateTime(cachedAt)}. It may be out of date; it refreshes when the connection returns.
      </span>
    </div>
  );
}
