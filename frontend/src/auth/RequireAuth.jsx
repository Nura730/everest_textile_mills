import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { ShieldOff, WifiOff } from 'lucide-react';
import { useAuth } from './AuthContext.jsx';
import { ROLE_LABELS } from './roles.js';
import { LoadingState } from '../components/ui/States.jsx';

/** Private routes: unauthenticated visitors go to /login and come back afterwards. */
export function RequireAuth() {
  const { status, retry } = useAuth();
  const location = useLocation();

  if (status === 'checking') return <LoadingState label="Checking your session…" fullPage />;
  if (status === 'unreachable') {
    return (
      <div className="full-page-center">
        <div className="state-box">
          <WifiOff size={28} aria-hidden="true" />
          <h2>Cannot reach the server</h2>
          <p>Your session is kept. Check that the backend is running, then try again.</p>
          <button type="button" className="erp-btn-primary" onClick={retry}>Try again</button>
        </div>
      </div>
    );
  }
  if (status !== 'signedIn') return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

/**
 * Hides a screen from roles that may not use it. The backend would reject their API calls anyway;
 * this just shows an honest "no access" page instead of a screen full of errors.
 */
export function RequireRole({ roles, children }) {
  const { user } = useAuth();
  if (!roles.includes(user.role)) {
    return (
      <div className="state-box" style={{ margin: '48px auto' }}>
        <ShieldOff size={28} aria-hidden="true" />
        <h2>No access</h2>
        <p>
          Your role ({ROLE_LABELS[user.role]}) does not have access to this screen. If you need it, ask an
          administrator.
        </p>
      </div>
    );
  }
  return children;
}
