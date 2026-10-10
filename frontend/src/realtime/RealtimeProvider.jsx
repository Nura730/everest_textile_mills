import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { currentToken } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { RealtimeContext } from './realtimeBus.js';

// Development: Vite proxies /socket.io to the backend. Production: VITE_SOCKET_URL, or the origin of
// an absolute VITE_API_BASE_URL, or this page's origin.
function socketUrl() {
  if (import.meta.env.VITE_SOCKET_URL) return import.meta.env.VITE_SOCKET_URL;
  const api = import.meta.env.VITE_API_BASE_URL;
  return api && /^https?:\/\//.test(api) ? new URL(api).origin : undefined;
}

/** One Socket.IO connection per signed-in session (Phase 16), authenticated with the API token. */
export function RealtimeProvider({ children }) {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set());

  useEffect(() => {
    const token = currentToken();
    if (!user || !token) return undefined;
    const socket = io(socketUrl(), { auth: { token }, transports: ['websocket', 'polling'] });
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('activity', (entry) => listeners.current.forEach((listener) => listener(entry)));
    return () => {
      socket.disconnect();
      setConnected(false);
    };
  }, [user]);

  const subscribe = useCallback((listener) => {
    listeners.current.add(listener);
    return () => listeners.current.delete(listener);
  }, []);
  const value = useMemo(() => ({ connected, subscribe }), [connected, subscribe]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
