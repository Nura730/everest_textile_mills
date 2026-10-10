import { CloudOff, RefreshCw, Wifi } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useRealtimeStatus } from '../realtime/realtimeBus.js';
import { formatDateTime } from '../utils/format.js';
import { dismiss, flush, isFlushing, queuedItems, startAutoSync, subscribe } from './syncManager.js';

/**
 * Header indicator (Phases 15-16): online/offline and live status, actions waiting to sync, and the
 * ones the server could not apply (conflicts and rejections) for the user to review and dismiss.
 */
export function SyncStatus() {
  const { user } = useAuth();
  const live = useRealtimeStatus();
  const [online, setOnline] = useState(() => navigator.onLine);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const refresh = async () => {
      setItems(await queuedItems(user.id));
      setBusy(isFlushing());
    };
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const unsubscribe = subscribe(refresh);
    const stop = startAutoSync(user.id);
    refresh();
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
      unsubscribe();
      stop();
    };
  }, [user.id]);

  const pending = items.filter((i) => i.status === 'PENDING');
  const problems = items.filter((i) => i.status !== 'PENDING');
  let label = live ? 'Live' : 'Online';
  if (!online) label = 'Offline';
  if (pending.length) label = `${pending.length} to sync`;
  if (problems.length) label = `${problems.length} need review`;

  return (
    <div className="sync-status">
      <button
        type="button"
        className={`erp-btn-outline sync-chip ${!online ? 'is-offline' : ''} ${problems.length ? 'has-problems' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={online ? (live ? 'Connected; updates arrive live' : 'Connected') : 'No connection: floor and QC actions are saved on this device'}
      >
        {online ? <Wifi size={14} aria-hidden="true" /> : <CloudOff size={14} aria-hidden="true" />}
        <span>{label}</span>
        {live && online && <span className="live-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="sync-panel" role="dialog" aria-label="Offline sync">
          <div className="sync-panel-head">
            <strong>{online ? 'Connected' : 'Working offline'}</strong>
            <button type="button" className="erp-btn-outline erp-btn-sm" disabled={!online || busy || pending.length === 0} onClick={() => flush(user.id)}>
              <RefreshCw size={13} aria-hidden="true" /> {busy ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
          <p className="cell-sub">
            {online ? (live ? 'Screens refresh by themselves when something changes.' : 'Live updates are reconnecting.') : 'Pausing or resuming runs, recording rolls, reporting machine problems, QC inspections and finishing rework are saved on this device and sent when the connection returns.'}
          </p>
          {items.length === 0 && <p className="cell-sub">Nothing waiting to sync.</p>}
          <ul className="sync-list">
            {items.map((item) => (
              <li key={item.eventId} className={`sync-item ${item.status.toLowerCase()}`}>
                <div>
                  <strong>{item.label}</strong>
                  <div className="cell-sub">Recorded {formatDateTime(item.recordedAt)} · {item.status === 'PENDING' ? 'waiting to sync' : item.status === 'CONFLICT' ? 'not applied: changed meanwhile' : 'not applied'}</div>
                  {item.message && <div className="sync-message">{item.message}</div>}
                </div>
                {item.status !== 'PENDING' && <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => dismiss(item.eventId)}>Dismiss</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
