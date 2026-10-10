import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { configureApi } from '../api/client.js';
import { authApi } from '../api/endpoints.js';
import { useToast } from '../components/ui/Toast.jsx';

/*
 * Session handling.
 *  - The token is kept in sessionStorage: it survives a page refresh, ends when the tab closes, and is
 *    never written anywhere else. The password is never stored.
 *  - On load, a stored token is re-validated with GET /auth/me (the backend decides whether it is
 *    still good: expired, revoked or deactivated accounts get 401).
 *  - Any 401 from any request ends the session and sends the user to the login page.
 *  - The UI hides what a role cannot do, but the backend enforces every permission.
 */

const STORAGE_KEY = 'everest.session';
const AuthContext = createContext(null);

function readStoredSession() {
  try {
    const session = JSON.parse(sessionStorage.getItem(STORAGE_KEY));
    if (session?.token && Date.parse(session.expiresAt) > Date.now()) return session;
  } catch {
    // Corrupt or blocked storage: treat as signed out.
  }
  sessionStorage.removeItem(STORAGE_KEY);
  return null;
}

export function AuthProvider({ children }) {
  const toast = useToast();
  const [session, setSession] = useState(readStoredSession); // { token, expiresAt }
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(session ? 'checking' : 'signedOut'); // checking | signedIn | signedOut | unreachable
  const tokenRef = useRef(session?.token ?? null);

  const endSession = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    tokenRef.current = null;
    setSession(null);
    setUser(null);
    setStatus('signedOut');
  }, []);

  const handleUnauthorized = useCallback(
    (error) => {
      if (!tokenRef.current) return;
      endSession();
      toast.warning(
        error.code === 'TOKEN_EXPIRED'
          ? 'Session expired. Please sign in again.'
          : 'Your session is no longer valid. Please sign in again.',
        { title: 'Signed out' },
      );
    },
    [endSession, toast],
  );

  // The API client reads the token and reports 401s through these callbacks.
  useEffect(() => {
    configureApi({ tokenGetter: () => tokenRef.current, unauthorizedHandler: handleUnauthorized });
  }, [handleUnauthorized]);

  const verify = useCallback(async () => {
    setStatus('checking');
    try {
      const { data } = await authApi.me();
      setUser(data.user);
      setStatus('signedIn');
    } catch (error) {
      // 401 is handled by handleUnauthorized (signs out). Anything else — network down, 5xx — must not
      // silently log the user out: show "cannot reach the server" with a retry.
      if (error.status !== 401) setStatus('unreachable');
    }
  }, []);

  // Re-validate a stored session once on load (page refresh).
  useEffect(() => {
    if (session && status === 'checking' && !user) verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sign out exactly when the token expires, instead of waiting for the next failed request.
  useEffect(() => {
    if (!session) return undefined;
    const ms = Date.parse(session.expiresAt) - Date.now();
    const timer = setTimeout(() => handleUnauthorized({ code: 'TOKEN_EXPIRED' }), Math.max(0, ms));
    return () => clearTimeout(timer);
  }, [session, handleUnauthorized]);

  const login = useCallback(async (email, password) => {
    const { data } = await authApi.login(email, password);
    const next = { token: data.token, expiresAt: data.expiresAt };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    tokenRef.current = data.token;
    setSession(next);
    setUser(data.user);
    setStatus('signedIn');
    return data.user;
  }, []);

  const logout = useCallback(() => {
    endSession();
    toast.info('You have been signed out.');
  }, [endSession, toast]);

  const value = useMemo(() => ({ user, status, login, logout, retry: verify }), [user, status, login, logout, verify]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
