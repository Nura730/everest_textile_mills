import { CloudOff, RefreshCw, Wifi } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useRealtimeStatus } from '../realtime/realtimeBus.js';
import { formatDateTime } from '../utils/format.js';
import { QUEUE_STATUS } from './conflictResolver.js';
import { QueueItem } from './PendingActions.jsx';
import { flush, onSynced, startAutoSync } from './syncManager.js';
import { useOnline, useQueue, useSyncState } from './useQueue.js';

/**
 * Header indicator: online/offline and live status, last successful sync, actions waiting, syncing,
 * and the ones that failed or need review, with Retry / Discard. Starts the sync engine for the
 * signed-in user (on sign-in, app start, reconnect, tab focus and every 15 s).
 */
export function SyncStatus() {
  const { user } = useAuth();
  const toast = useToast();
  const live = useRealtimeStatus();
  const online = useOnline();
  const items = useQueue();
  const { syncing, lastSyncAt } = useSyncState();
  const [open, setOpen] = useState(false);

  useEffect(() => startAutoSync(user.id), [user.id]);
  useEffect(
    () =>
      onSynced((applied) => {
        toast.success(applied.length === 1 ? `Synced successfully: ${applied[0].label}.` : `Synced successfully: ${applied.length} actions.`, { title: 'Synced' });
      }),
    [toast],
  );

  const pending = items.filter((i) => i.status === QUEUE_STATUS.PENDING);
  const failed = items.filter((i) => i.status === QUEUE_STATUS.FAILED);
  const review = items.filter((i) => i.status === QUEUE_STATUS.CONFLICT || i.status === QUEUE_STATUS.REJECTED);

  let label = live ? 'Live' : 'Online';
  if (!online) label = 'Offline';
  if (pending.length) label = syncing ? 'Syncing…' : `${pending.length} waiting to sync`;
  if (failed.length + review.length) label = `${failed.length + review.length} need attention`;

  return (
    <div className="sync-status">
      <button
        type="button"
        className={`erp-btn-outline sync-chip ${!online ? 'is-offline' : ''} ${failed.length + review.length ? 'has-problems' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={online ? (live ? 'Connected; updates arrive live' : 'Connected') : 'No connection: supported actions are saved on this device'}
      >
        {online ? <Wifi size={14} aria-hidden="true" /> : <CloudOff size={14} aria-hidden="true" />}
        <span>{label}</span>
        {live && online && <span className="live-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="sync-panel" role="dialog" aria-label="Offline sync">
          <div className="sync-panel-head">
            <strong>{online ? 'Connected' : 'Working offline'}</strong>
            <button type="button" className="erp-btn-outline erp-btn-sm" disabled={!online || syncing || pending.length === 0} onClick={() => flush({ force: true })}>
              <RefreshCw size={13} aria-hidden="true" /> {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
          <p className="cell-sub">
            Last successful sync: {lastSyncAt ? formatDateTime(lastSyncAt) : 'not yet on this device'} · {pending.length} waiting · {failed.length} failed · {review.length} to review
          </p>
          <p className="cell-sub">
            {online
              ? live
                ? 'Screens refresh by themselves when something changes.'
                : 'Live updates are reconnecting.'
              : 'Saved offline: run pause/resume/complete, rolls, machine problems, QC inspections, rework, placing or editing an order, yarn receipts. Everything else needs a connection.'}
          </p>
          {items.length === 0 && <p className="cell-sub">Nothing waiting to sync.</p>}
          <ul className="sync-list">{items.map((item) => <QueueItem key={item.eventId} item={item} syncing={syncing} />)}</ul>
        </div>
      )}
    </div>
  );
}
