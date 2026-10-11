import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { fieldErrorsOf } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ROLE_LABELS } from '../auth/roles.js';
import { Modal } from '../components/ui/Modal.jsx';
import { useToast } from '../components/ui/Toast.jsx';

const DEMO_ACCOUNTS = [
  { label: 'Admin', email: 'admin@everest.local', role: 'ADMIN' },
  { label: 'Floor Manager', email: 'floor@everest.local', role: 'FLOOR_MANAGER' },
  { label: 'Store Keeper', email: 'store@everest.local', role: 'STORE_KEEPER' },
  { label: 'QC Inspector', email: 'qc@everest.local', role: 'QC_INSPECTOR' },
  { label: 'Buyer', email: 'buyer@everest.local', role: 'BUYER' },
];

function loginErrorMessage(error) {
  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      return 'Invalid email or password. If your account was deactivated, contact an administrator.';
    case 'TOO_MANY_REQUESTS': {
      const minutes = Math.ceil((error.details?.retryAfterSeconds ?? 60) / 60);
      return `Too many failed attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
    }
    default:
      return error.message || 'Unable to connect to server. Please verify backend is running.';
  }
}

/**
 * There is no self-registration: accounts are created by an ADMIN (POST /api/users), and buyer
 * companies by an ADMIN (POST /api/buyers). This explains that instead of pretending to sign up.
 */
function AccountHelpModal({ onClose }) {
  return (
    <Modal
      title="Getting an account"
      subtitle="Everest accounts are created by the factory administrator."
      onClose={onClose}
      footer={
        <button type="button" className="erp-btn-primary" onClick={onClose}>
          Got it
        </button>
      }
    >
      <p className="confirm-message">
        There is no self-registration. Ask the factory administrator to create your account: staff accounts
        are created under <strong>Users</strong>, and a buyer account is linked to its company, which the
        administrator adds under <strong>Buyers</strong>. You will receive your email and password from them.
      </p>
    </Modal>
  );
}

export default function Login() {
  const { status, login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [showAccountHelp, setShowAccountHelp] = useState(false);
  const [showDemoShelf, setShowDemoShelf] = useState(false);

  if (status === 'signedIn') return <Navigate to="/dashboard" replace />;

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const errors = {};
    if (!email.trim()) errors.email = 'Enter your email.';
    if (!password) errors.password = 'Enter your password.';
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      const user = await login(email.trim(), password);
      toast.success(`Signed in as ${user.name} (${ROLE_LABELS[user.role]}).`);
      navigate(location.state?.from?.pathname ?? '/dashboard', {
        replace: true,
      });
    } catch (error) {
      setFieldErrors(fieldErrorsOf(error));
      setFormError(
        error.code === 'VALIDATION_ERROR' ? null : loginErrorMessage(error),
      );
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  // Fills the email only. Passwords never live in frontend code: the dev password is SEED_PASSWORD in
  // backend/.env (docs/DEV_ACCOUNTS.md).
  function pickDemoAccount(demo) {
    setEmail(demo.email);
    setPassword('');
    setFieldErrors({});
    setFormError(null);
    document.getElementById('password')?.focus();
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">Everest Textile Mills</h1>
        <p className="login-sub">Sign in to access the system</p>

        {formError && (
          <div className="login-error" role="alert">
            {formError}
          </div>
        )}

        <form onSubmit={onSubmit} noValidate>
          <div className="login-form-group">
            <label className="login-form-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className={`login-input ${fieldErrors.email ? 'has-error' : ''}`}
              placeholder="Enter your email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
              autoFocus
            />
            {fieldErrors.email && (
              <span className="login-field-error">{fieldErrors.email}</span>
            )}
          </div>

          <div className="login-form-group">
            <label className="login-form-label" htmlFor="password">
              Password
            </label>
            <div className="login-input-wrap">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className={`login-input login-input-with-toggle ${fieldErrors.password ? 'has-error' : ''}`}
                placeholder="Enter your password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
              <button
                type="button"
                className="login-password-toggle"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {fieldErrors.password && (
              <span className="login-field-error">{fieldErrors.password}</span>
            )}
          </div>

          <button
            type="submit"
            className="login-submit-btn"
            disabled={busy}
          >
            {busy && <Loader2 size={16} className="spin" aria-hidden="true" />}
            {busy ? 'Signing In…' : 'Sign In'}
          </button>

          <div className="login-footer">
            <span>Don't have an account?</span>
            <button
              type="button"
              className="create-company-link"
              onClick={() => setShowAccountHelp(true)}
            >
              How to get one
            </button>
          </div>
        </form>
      </div>

      {import.meta.env.DEV && (
        <aside className="login-dev-shelf" aria-label="Development helpers">
          <button
            type="button"
            className="login-dev-shelf-toggle"
            onClick={() => setShowDemoShelf((open) => !open)}
          >
            {showDemoShelf ? 'Hide development accounts' : 'Development accounts (local builds only)'}
          </button>
          {showDemoShelf && (
            <div className="login-dev-pills">
              {DEMO_ACCOUNTS.map((demo) => (
                <button
                  key={demo.email}
                  type="button"
                  className="login-demo-pill"
                  onClick={() => pickDemoAccount(demo)}
                  title={`Fill ${demo.email}`}
                >
                  {demo.label}
                </button>
              ))}
            </div>
          )}
        </aside>
      )}

      {showAccountHelp && <AccountHelpModal onClose={() => setShowAccountHelp(false)} />}
    </div>
  );
}
