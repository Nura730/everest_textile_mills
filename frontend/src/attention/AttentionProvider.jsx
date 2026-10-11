import { useEffect, useMemo, useRef } from 'react';
import { useToast } from '../components/ui/Toast.jsx';
import { attentionApi } from '../api/endpoints.js';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { liveMatch, useLive } from '../realtime/realtimeBus.js';
import { AttentionContext } from './attentionContext.js';

/** Loads the attention summary once for the layout; refreshes on live changes and every minute. */
export function AttentionProvider({ children }) {
  const query = useApiQuery(() => attentionApi.get(), [], { cacheKey: 'attention' });
  useLive(liveMatch.any, query.reload, 3000);
  const toast = useToast();
  const seen = useRef(null); // alert keys already known; null until the first load
  useEffect(() => {
    const alerts = query.data?.alerts;
    if (!alerts) return;
    const keys = new Set(alerts.map((a) => a.key));
    // Warn once when a NEW high-priority issue appears; the first load is shown on the dashboard instead.
    if (seen.current) {
      for (const alert of alerts) {
        if (alert.priority === 'HIGH' && !seen.current.has(alert.key)) toast.warning(alert.why, { title: alert.title });
      }
    }
    seen.current = keys;
  }, [query.data, toast]);
  useEffect(() => {
    const timer = setInterval(() => query.reload(), 60_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const value = useMemo(
    () => ({
      alerts: query.data?.alerts ?? [],
      badges: query.data?.badges ?? {},
      loading: query.loading && !query.data,
      error: query.error,
      cachedAt: query.cachedAt,
      reload: query.reload,
    }),
    [query.data, query.loading, query.error, query.cachedAt, query.reload],
  );
  return <AttentionContext.Provider value={value}>{children}</AttentionContext.Provider>;
}
