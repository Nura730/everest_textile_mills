import { Activity, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CachedNotice } from '../offline/CachedNotice.jsx';
import { QUEUE_STATUS } from '../offline/conflictResolver.js';
import { useQueue } from '../offline/useQueue.js';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { ErrorState, LoadingState } from '../components/ui/States.jsx';
import { useAttention } from './attentionContext.js';

const PRIORITY_LABELS = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };

/**
 * Operational insights for the signed-in role: what needs attention, why it matters, which records,
 * and what this user may do. Every item is computed on the server from recorded data with fixed rules
 * (feasibility, delivery risk, machine and QC states), plus this device's unsynced actions.
 * Nothing is predicted beyond those rules.
 */
export function OperationalInsights() {
  const { alerts, loading, error, cachedAt, reload } = useAttention();
  const queue = useQueue();
  const waiting = queue.filter((i) => i.status === QUEUE_STATUS.PENDING).length;
  const problems = queue.filter((i) => i.status !== QUEUE_STATUS.PENDING).length;
  const local = [];
  if (problems) {
    local.push({ key: 'sync-problems', priority: 'HIGH', title: `${problems} action(s) on this device were not applied`, why: 'The server refused them or the record changed meanwhile. Your input is kept on this device.', affected: [], action: 'Open the sync panel in the header to review them.' });
  } else if (waiting) {
    local.push({ key: 'sync-waiting', priority: 'LOW', title: `${waiting} action(s) saved offline, waiting to sync`, why: 'They are not on the server yet; figures elsewhere do not include them.', affected: [], action: 'They are sent automatically when the connection returns.' });
  }
  const items = [...local, ...alerts];

  return (
    <section className="erp-card section-gap insights-panel" aria-labelledby="ops-insights-title">
      <div className="card-header">
        <div>
          <h3 className="card-title" id="ops-insights-title"><Activity size={16} aria-hidden="true" /> Operational insights</h3>
          <p className="card-subtitle">What needs your attention now, from recorded data and fixed business rules.</p>
        </div>
      </div>
      <CachedNotice cachedAt={cachedAt} />
      {error && !items.length && <ErrorState error={error} onRetry={reload} />}
      {loading && <LoadingState label="Checking what needs attention…" />}
      {!loading && !error && items.length === 0 && (
        <p className="insights-empty"><CheckCircle2 size={16} aria-hidden="true" /> Nothing needs your attention right now.</p>
      )}
      {items.length > 0 && (
        <ul className="insight-list">
          {items.map((item) => (
            <li key={item.key} className={`insight insight-${item.priority.toLowerCase()}`}>
              <div className="insight-head">
                <StatusBadge domain="PRIORITY" state={item.priority} label={PRIORITY_LABELS[item.priority]} />
                <strong>{item.to ? <Link to={item.to}>{item.title}</Link> : item.title}</strong>
              </div>
              <div className="insight-why">{item.why}</div>
              {item.affected?.length > 0 && (
                <div className="insight-affected">
                  {item.affected.map((a) => <Link key={a.label} to={a.to} className="insight-chip">{a.label}</Link>)}
                </div>
              )}
              {item.action && <div className="insight-action">→ {item.action}</div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
