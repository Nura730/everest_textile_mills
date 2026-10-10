import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads data from an endpoint function and exposes { data, meta, error, loading, reload }.
 * `deps` re-runs the request (filters, page); `reload()` refreshes after a mutation without a page
 * reload. Stale responses from earlier requests are ignored.
 */
export function useApiQuery(fetcher, deps = []) {
  const [state, setState] = useState({ data: null, meta: null, error: null, loading: true });
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const { data, meta } = await fetcher();
      if (seq === requestSeq.current) setState({ data, meta, error: null, loading: false });
    } catch (error) {
      if (seq === requestSeq.current) setState((current) => ({ ...current, error, loading: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load };
}
