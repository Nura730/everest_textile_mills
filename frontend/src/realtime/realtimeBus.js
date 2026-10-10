import { createContext, useContext, useEffect, useRef } from 'react';

/*
 * Phase 16: what pages use from the live connection. The provider (RealtimeProvider.jsx) delivers
 * each committed change the server lets this role see; pages pick the ones that concern them and
 * reload their data. Several changes in quick succession cause one reload.
 */
export const RealtimeContext = createContext({ connected: false, subscribe: () => () => {} });

export function useRealtimeStatus() {
  return useContext(RealtimeContext).connected;
}

/**
 * Calls `reload` when a live change matches. `match(entry)` decides; entries carry action,
 * entityType, entityId, orderId and machineId (buyers get action and orderId only).
 */
export function useLive(match, reload, delayMs = 400) {
  const { subscribe } = useContext(RealtimeContext);
  const latest = useRef({ match, reload });
  useEffect(() => {
    latest.current = { match, reload };
  });
  useEffect(() => {
    let timer = null;
    const unsubscribe = subscribe((entry) => {
      if (!latest.current.match(entry)) return;
      clearTimeout(timer);
      timer = setTimeout(() => latest.current.reload(), delayMs);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [subscribe, delayMs]);
}

/** Common matchers. */
export const liveMatch = {
  any: () => true,
  actions: (...prefixes) => (entry) => prefixes.some((p) => entry.action.startsWith(p)),
  order: (id) => (entry) => entry.orderId === id || entry.entityId === id,
  machine: (id) => (entry) => entry.machineId === id || entry.entityId === id,
  entity: (id) => (entry) => entry.entityId === id,
};
