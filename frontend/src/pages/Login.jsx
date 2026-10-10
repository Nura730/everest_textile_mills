import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Loader2, LogIn } from 'lucide-react';
import { fieldErrorsOf } from '../api/client.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ROLE_LABELS } from '../auth/roles.js';
import { Field } from '../components/ui/Modal.jsx';
import { useToast } from '../components/ui/Toast.jsx';

function loginErrorMessage(error) {
  switch (error.code) {
    case 'INVALID_CREDENTIALS':
      // The backend deliberately gives the same answer for unknown email, wrong password and
      // deactivated account, so the UI does not guess which one it was.
      return 'Invalid email or password. If your account was deactivated, contact an administrator.';
    case 'TOO_MANY_REQUESTS': {
      const minutes = Math.ceil((error.details?.retryAfterSeconds ?? 60) / 60);
      return `Too many failed attempts. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
    }
    default:
      return error.message;
  }
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

  if (status === 'signedIn') return <Navigate to="/dashboard" replace />;

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const errors = {};
    if (!email.trim()) errors.email = 'Enter your email address.';
    if (!password) errors.password = 'Enter your password.';
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      const user = await login(email.trim(), password);
      toast.success(`Signed in as ${user.name} (${ROLE_LABELS[user.role]}).`);
      navigate(location.state?.from?.pathname ?? '/dashboard', { replace: true });
    } catch (error) {
      setFieldErrors(fieldErrorsOf(error));
      setFormError(error.code === 'VALIDATION_ERROR' ? null : loginErrorMessage(error));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <section className="login-brand" aria-hidden="true">
        <div className="login-weave" />
        <div className="login-brand-content">
          <div className="login-brand-mark">ET</div>
          <h1>Everest Textile Mills</h1>
          <p>Yarn to fabric to dispatch — one traceable record for every order.</p>
          <ul>
            <li>Yarn inventory with a provable stock ledger</li>
            <li>Buyer orders with live status history</li>
            <li>Role-based access for every person on the floor</li>
          </ul>
        </div>
      </section>

      <section className="login-panel">
        <form className="login-card" onSubmit={onSubmit} noValidate aria-describedby={formError ? 'login-error' : undefined}>
          <h2>Sign in</h2>
          <p className="login-sub">Use the account your administrator created for you.</p>

          {formError && (
            <div className="login-error" id="login-error" role="alert">
              {formError}
            </div>
          )}

          <Field label="Email" htmlFor="email" error={fieldErrors.email}>
            <input
              id="email"
              type="email"
              className="erp-input"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
              aria-invalid={Boolean(fieldErrors.email)}
              autoFocus
            />
          </Field>

          <Field label="Password" htmlFor="password" error={fieldErrors.password}>
            <div className="password-wrap">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                className="erp-input"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
                aria-invalid={Boolean(fieldErrors.password)}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((shown) => !shown)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>

          <button type="submit" className="erp-btn-primary login-submit" disabled={busy}>
            {busy ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <LogIn size={16} aria-hidden="true" />}
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          {import.meta.env.DEV && (
            <p className="login-dev-hint">
              Development build: demo accounts are created by <code>npm run seed:dev</code> and listed in{' '}
              <code>docs/DEV_ACCOUNTS.md</code>.
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
