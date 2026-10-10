import { RefreshCw, Trash2 } from 'lucide-react';
import { formatDateTime } from '../utils/format.js';
import { QUEUE_STATUS } from './conflictResolver.js';
import { dismiss, retryItem } from './syncManager.js';
import { useQueue, useSyncState } from './useQueue.js';

const STATUS_TEXT = {
  PENDING: 'Saved offline — waiting to sync',
  SYNCING: 'Syncing…',
  FAILED: 'Sync failed — your changes are saved on this device',
  CONFLICT: 'Not applied — the record changed meanwhile',
  REJECTED: 'Not applied — the server refused it',
};

const HIDDEN_FIELDS = new Set(['signature', 'runId', 'rollId', 'machineId', 'orderId', 'productId', 'buyerId', 'expectedUpdatedAt']);
const humanKey = (key) => key.replace(/([A-Z])/g, ' $1').toLowerCase();

/** What the user entered, so nothing typed is lost when an action is refused. */
function Entered({ payload }) {
  const rows = Object.entries(payload ?? {}).filter(([key, value]) => !HIDDEN_FIELDS.has(key) && value !== null && value !== undefined && typeof value !== 'object');
  if (!rows.length) return null;
  return <div className="cell-sub">You entered: {rows.map(([key, value]) => `${humanKey(key)} ${value}`).join(' · ')}</div>;
}

/** One queued action with its status and the actions the user can take. */
export function QueueItem({ item, syncing }) {
  const status = item.status === QUEUE_STATUS.PENDING && syncing ? 'SYNCING' : item.status;
  return (
    <li className={`sync-item ${item.status.toLowerCase()}`}>
      <div>
        <strong>{item.label}</strong>
        <div className="cell-sub">
          {STATUS_TEXT[status]} · recorded {formatDateTime(item.recordedAt)}
          {item.attempts > 0 && item.status !== QUEUE_STATUS.CONFLICT && item.status !== QUEUE_STATUS.REJECTED && ` · ${item.attempts} failed attempt(s)`}
        </div>
        {item.message && <div className="sync-message">{item.message}</div>}
        {item.status !== QUEUE_STATUS.PENDING && <Entered payload={item.payload} />}
      </div>
      <div className="sync-item-actions">
        {item.status === QUEUE_STATUS.FAILED && (
          <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => retryItem(item.eventId)}>
            <RefreshCw size={13} aria-hidden="true" /> Retry
          </button>
        )}
        {item.status !== QUEUE_STATUS.PENDING && (
          <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => dismiss(item.eventId)} title="Remove from this device; nothing is sent">
            <Trash2 size={13} aria-hidden="true" /> Discard
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * Actions on this record that are saved on this device but not yet applied on the server, shown where
 * the user works (run, machine, roll, order). `onApplied` reloads the screen once they are synced.
 */
export function PendingActions({ match, onApplied, title = 'Not yet on the server' }) {
  const items = useQueue(match, onApplied);
  const { syncing } = useSyncState();
  if (!items.length) return null;
  return (
    <div className="erp-card section-gap pending-actions" role="status">
      <div className="card-header">
        <div>
          <h3 className="card-title">{title}</h3>
          <p className="card-subtitle">These actions are saved on this device only. The figures below do not include them until they sync.</p>
        </div>
      </div>
      <ul className="sync-list">{items.map((item) => <QueueItem key={item.eventId} item={item} syncing={syncing} />)}</ul>
    </div>
  );
}
