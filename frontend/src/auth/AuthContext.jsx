import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { configureApi } from '../api/client.js';
import { authApi } from '../api/endpoints.js';
import { useToast } from '../components/ui/Toast.jsx';
import { clearCacheFor, clearOtherUsersCache, setCacheUser } from '../offline/cache.js';
import { queuedItems } from '../offline/syncManager.js';

/*
 * Session handling.
 *  - The token is kept in sessionStorage: it survives a page refresh, ends when the tab closes, and is
 *    never written anywhere else. The password is never stored.
 *  - On load, a stored token is re-validated with GET /auth/me (the backend decides whether it is
 *    still good: expired, revoked or deactivated accounts get 401).
 *  - Any 401 from any request ends the session and sends the user to the login page.
 *  - Offline-first: the session also keeps the user's PUBLIC profile (id, name, email, role, company).
 *    If the server cannot be reached on a page refresh, a stored, unexpired session opens the app from
 *    that profile so cached screens and queued actions stay usable; the server still checks the token
 *    on every request and on sync, and the session is re-verified as soon as the connection returns.
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
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const endSession = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    tokenRef.current = null;
    setCacheUser(null);
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

  const verify = useCallback(async ({ quiet = false } = {}) => {
    const token = tokenRef.current;
    if (!quiet) setStatus('checking');
    try {
      const { data } = await authApi.me();
      // The session may have ended while this check was in flight (sign-out, or a 401 elsewhere):
      // a late answer must never bring an ended session back.
      if (!token || tokenRef.current !== token) return;
      const stored = sessionRef.current;
      if (stored) {
        const next = { ...stored, user: data.user };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        sessionRef.current = next;
      }
      setUser(data.user);
      setStatus('signedIn');
    } catch (error) {
      // 401 is handled by handleUnauthorized (signs out). Anything else — network down, 5xx — must not
      // silently log the user out. Offline with a stored profile: open the app from it (offline-first);
      // otherwise show "cannot reach the server" with a retry.
      if (error.status === 401 || quiet || tokenRef.current !== token) return;
      const stored = sessionRef.current;
      if (error.isNetworkError && stored?.user) {
        setUser(stored.user);
        setStatus('signedIn');
      } else setStatus('unreachable');
    }
  }, []);

  // Opened offline from the stored profile: re-check the session with the server once back online.
  useEffect(() => {
    if (status !== 'signedIn') return undefined;
    const recheck = () => verify({ quiet: true });
    window.addEventListener('online', recheck);
    return () => window.removeEventListener('online', recheck);
  }, [status, verify]);

  // The device cache belongs to the signed-in user; another person's cached screens are removed.
  useEffect(() => {
    setCacheUser(user?.id ?? null);
    if (user?.id) clearOtherUsersCache(user.id);
  }, [user?.id]);

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
    const next = { token: data.token, expiresAt: data.expiresAt, user: data.user };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    tokenRef.current = data.token;
    setSession(next);
    setUser(data.user);
    setStatus('signedIn');
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    const leaving = user;
    const waiting = leaving ? (await queuedItems(leaving.id)).length : 0;
    if (leaving) await clearCacheFor(leaving.id);
    endSession();
    toast.info(
      waiting
        ? `You have been signed out. ${waiting} action(s) stay saved on this device and will sync the next time you sign in.`
        : 'You have been signed out.',
    );
  }, [endSession, toast, user]);

  const value = useMemo(() => ({ user, status, login, logout, retry: verify }), [user, status, login, logout, verify]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
