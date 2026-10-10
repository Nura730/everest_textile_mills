import { useCallback, useEffect, useRef, useState } from 'react';
import { readCache, writeCache } from '../offline/cache.js';

/**
 * Loads data from an endpoint function and exposes { data, meta, error, loading, reload, cachedAt }.
 * `deps` re-runs the request (filters, page); `reload()` refreshes after a mutation without a page
 * reload. Stale responses from earlier requests are ignored.
 *
 * Offline-first reading: with `{ cacheKey }` every successful response is saved for this user, and
 * when the server cannot be reached the last saved response is shown instead of an error, with
 * `cachedAt` set to when it was saved (screens show it with <CachedNotice>). Online, the server is
 * always asked first; the cache is never shown as fresh data.
 */
export function useApiQuery(fetcher, deps = [], { cacheKey } = {}) {
  const [state, setState] = useState({ data: null, meta: null, error: null, loading: true, cachedAt: null });
  const requestSeq = useRef(0);
  const keyRef = useRef(cacheKey);
  keyRef.current = cacheKey;

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    const key = keyRef.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const { data, meta } = await fetcher();
      if (seq !== requestSeq.current) return;
      setState({ data, meta, error: null, loading: false, cachedAt: null });
      if (key) writeCache(key, { data, meta });
    } catch (error) {
      if (seq !== requestSeq.current) return;
      const cached = key && error?.isNetworkError ? await readCache(key) : null;
      if (seq !== requestSeq.current) return;
      if (cached) setState({ data: cached.data, meta: cached.meta, error: null, loading: false, cachedAt: cached.savedAt });
      else setState((current) => ({ ...current, error, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load };
}
