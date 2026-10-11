import { createContext, useContext } from 'react';

/**
 * What needs the signed-in user's attention (GET /api/summary/attention): alerts for the dashboard's
 * operational insights and counts for the navigation badges. Derived on the server from recorded data,
 * scoped to the user's role (and company, for buyers). Never hard-coded.
 */
export const AttentionContext = createContext({ alerts: [], badges: {}, loading: true, error: null, cachedAt: null, reload: () => {} });

export function useAttention() {
  return useContext(AttentionContext);
}
