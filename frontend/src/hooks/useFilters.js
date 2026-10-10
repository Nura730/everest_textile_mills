import { useCallback, useMemo, useState } from 'react';

/**
 * Filter state for a server-filtered list. Changing any filter goes back to page 1 (the old page
 * may not exist in the new result), and `query` drops empty values so the API only receives the
 * filters actually in use. `active` drives the "Clear filters" button and the no-match message.
 */
export function useFilters(defaults) {
  const [filters, setFilters] = useState(defaults);
  const [page, setPage] = useState(1);

  const set = useCallback((key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }, []);

  const clear = useCallback(() => {
    setFilters(defaults);
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const query = useMemo(
    () => Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== '' && value !== false && value != null)),
    [filters],
  );
  const active = Object.entries(filters).some(([key, value]) => value !== defaults[key]);

  return { filters, set, clear, query, active, page, setPage };
}
