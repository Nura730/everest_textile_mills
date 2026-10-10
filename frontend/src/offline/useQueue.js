import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { onSynced, queuedItems, subscribe, syncState } from './syncManager.js';

/**
 * The signed-in user's queued actions that match `match(item)` (e.g. those for one run), kept up to
 * date. `onApplied(items)` runs when matching actions were applied on the server, so the screen can
 * reload the authoritative data and drop its "waiting to sync" rows.
 */
export function useQueue(match = () => true, onApplied) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const latest = useRef({ match, onApplied });
  useEffect(() => {
    latest.current = { match, onApplied };
  });

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const all = await queuedItems(user?.id);
      if (active) setItems(all.filter((item) => latest.current.match(item)));
    };
    const unsubscribe = subscribe(refresh);
    const unsynced = onSynced((applied) => {
      const mine = applied.filter((item) => latest.current.match(item));
      if (mine.length) latest.current.onApplied?.(mine);
    });
    refresh();
    return () => {
      active = false;
      unsubscribe();
      unsynced();
    };
  }, [user?.id]);

  return items;
}

/** Re-renders on every queue/state change and returns the sync state (syncing, lastSyncAt, paused). */
export function useSyncState() {
  const [snapshot, setSnapshot] = useState(syncState);
  useEffect(() => subscribe(() => setSnapshot(syncState())), []);
  return snapshot;
}

/** navigator.onLine, kept up to date. */
export function useOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}
