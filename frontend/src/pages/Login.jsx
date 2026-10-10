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

function CreateCompanyModal({ onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({
    companyName: '',
    millType: 'Spinning & Weaving Mill',
    adminName: '',
    email: '',
    password: '',
    location: '',
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function handleSubmit(event) {
    event.preventDefault();
    const found = {};
    if (!form.companyName.trim()) found.companyName = 'Company name is required.';
    if (!form.adminName.trim()) found.adminName = 'Administrator name is required.';
    if (!form.email.trim()) found.email = 'Valid work email is required.';
    if (form.password.length < 10) found.password = 'Password must be at least 10 characters.';

    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    // Simulate tenant provisioning delay
    setTimeout(() => {
      setSubmitting(false);
      toast.success(`Company account created for ${form.companyName}! You can now sign in.`);
      onCreated(form.email);
    }, 600);
  }

  return (
    <Modal
      title="Create Company Account"
      subtitle="Register a new manufacturing tenant and primary administrator."
      onClose={onClose}
      busy={submitting}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="erp-btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Creating workspace…' : 'Create Account'}
          </button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div className="login-form-group" style={{ marginBottom: 0 }}>
          <label className="login-form-label" htmlFor="reg-company">Company / Mill Name</label>
          <input
            id="reg-company"
            type="text"
            className={`erp-input ${errors.companyName ? 'erp-input-error' : ''}`}
            placeholder="e.g. Everest Textile Mills Ltd."
            value={form.companyName}
            onChange={update('companyName')}
            autoFocus
          />
          {errors.companyName && <span className="login-field-error">{errors.companyName}</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="login-form-group" style={{ marginBottom: 0 }}>
            <label className="login-form-label" htmlFor="reg-type">Mill Type</label>
            <select
              id="reg-type"
              className="erp-input"
              value={form.millType}
              onChange={update('millType')}
            >
              <option value="Spinning & Weaving Mill">Spinning & Weaving Mill</option>
              <option value="Knitting & Garment Unit">Knitting & Garment Unit</option>
              <option value="Dyeing & Processing">Dyeing & Processing</option>
              <option value="Yarn & Fabric Wholesaler">Yarn & Fabric Wholesaler</option>
            </select>
          </div>

          <div className="login-form-group" style={{ marginBottom: 0 }}>
            <label className="login-form-label" htmlFor="reg-location">Location / City</label>
            <input
              id="reg-location"
              type="text"
              className="erp-input"
              placeholder="e.g. Tiruppur, Tamil Nadu"
              value={form.location}
              onChange={update('location')}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div className="login-form-group" style={{ marginBottom: 0 }}>
            <label className="login-form-label" htmlFor="reg-admin">Administrator Name</label>
            <input
              id="reg-admin"
              type="text"
              className={`erp-input ${errors.adminName ? 'erp-input-error' : ''}`}
              placeholder="e.g. Arun Shanmugavel"
              value={form.adminName}
              onChange={update('adminName')}
            />
            {errors.adminName && <span className="login-field-error">{errors.adminName}</span>}
          </div>

          <div className="login-form-group" style={{ marginBottom: 0 }}>
            <label className="login-form-label" htmlFor="reg-email">Work Email</label>
            <input
              id="reg-email"
              type="email"
              className={`erp-input ${errors.email ? 'erp-input-error' : ''}`}
              placeholder="e.g. admin@everesttextiles.com"
              value={form.email}
              onChange={update('email')}
            />
            {errors.email && <span className="login-field-error">{errors.email}</span>}
          </div>
        </div>

        <div className="login-form-group" style={{ marginBottom: 0 }}>
          <label className="login-form-label" htmlFor="reg-password">Admin Password (≥ 10 characters)</label>
          <input
            id="reg-password"
            type="password"
            className={`erp-input ${errors.password ? 'erp-input-error' : ''}`}
            placeholder="Enter a secure password"
            value={form.password}
            onChange={update('password')}
          />
          {errors.password && <span className="login-field-error">{errors.password}</span>}
        </div>
      </form>
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
  const [showCompanyModal, setShowCompanyModal] = useState(false);
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

  function pickDemoAccount(demo) {
    setEmail(demo.email);
    setPassword('Everest-Dev-bf7ba8');
    setFieldErrors({});
    setFormError(null);
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
              onClick={() => setShowCompanyModal(true)}
            >
              Create Company Account
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
            {showDemoShelf ? 'Hide demo accounts' : 'Demo accounts for testing'}
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

      {showCompanyModal && (
        <CreateCompanyModal
          onClose={() => setShowCompanyModal(false)}
          onCreated={(createdEmail) => {
            setShowCompanyModal(false);
            if (createdEmail) setEmail(createdEmail);
          }}
        />
      )}
    </div>
  );
}
