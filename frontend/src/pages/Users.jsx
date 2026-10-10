import { useState } from 'react';
import { Plus } from 'lucide-react';
import { fieldErrorsOf } from '../api/client.js';
import { buyersApi, usersApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ROLES, ROLE_LABELS } from '../auth/roles.js';
import { FilterBar, FilterSelect, SearchInput } from '../components/ui/Filters.jsx';
import { ConfirmDialog, Field, Modal } from '../components/ui/Modal.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, ListLimitNotice, LoadingState } from '../components/ui/States.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useFilters } from '../hooks/useFilters.js';

const NO_FILTERS = { q: '', role: '', isActive: '' };
const STATUS_OPTIONS = [{ value: 'true', label: 'Active' }, { value: 'false', label: 'Deactivated' }];
import { formatDateTime } from '../utils/format.js';

function CreateUserModal({ buyers, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: ROLES.STORE_KEEPER, buyerId: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const found = {};
    if (form.password.length < 10) found.password = 'At least 10 characters.';
    if (form.role === ROLES.BUYER && !form.buyerId) found.buyerId = 'A buyer account must belong to a buyer company.';
    setErrors(found);
    if (Object.keys(found).length) return;

    const body = { name: form.name, email: form.email, password: form.password, role: form.role };
    if (form.role === ROLES.BUYER) body.buyerId = form.buyerId;
    setBusy(true);
    try {
      const { data } = await usersApi.create(body);
      toast.success(`Account created for ${data.user.name} (${ROLE_LABELS[data.user.role]}).`);
      onCreated();
    } catch (error) {
      if (error.code === 'DUPLICATE_RESOURCE') setErrors({ email: 'An account with this email already exists.' });
      else {
        const fields = fieldErrorsOf(error);
        setErrors(fields);
        if (!Object.keys(fields).length) toast.error(error, { title: 'Account not created' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Create account"
      subtitle="There is no public sign-up: every account is created here by an administrator."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="user-form" className="erp-btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        </>
      }
    >
      <form id="user-form" className="erp-form-grid" onSubmit={onSubmit} noValidate autoComplete="off">
        <Field label="Full name" htmlFor="u-name" error={errors.name} required>
          <input id="u-name" className="erp-input" value={form.name} onChange={update('name')} disabled={busy} />
        </Field>
        <Field label="Email" htmlFor="u-email" error={errors.email} required>
          <input id="u-email" type="email" className="erp-input" value={form.email} onChange={update('email')} disabled={busy} />
        </Field>
        <Field label="Initial password" htmlFor="u-password" error={errors.password} hint="At least 10 characters. Share it with the person securely." required>
          <input id="u-password" type="password" className="erp-input" autoComplete="new-password" value={form.password} onChange={update('password')} disabled={busy} />
        </Field>
        <Field label="Role" htmlFor="u-role" error={errors.role} required>
          <select id="u-role" className="erp-input" value={form.role} onChange={update('role')} disabled={busy}>
            {Object.values(ROLES).map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
          </select>
        </Field>
        {form.role === ROLES.BUYER && (
          <Field label="Buyer company" htmlFor="u-buyer" error={errors.buyerId} hint="The user will see only this company's orders." required>
            <select id="u-buyer" className="erp-input" value={form.buyerId} onChange={update('buyerId')} disabled={busy}>
              <option value="">Select a company…</option>
              {buyers.map((buyer) => <option key={buyer.id} value={buyer.id}>{buyer.code} — {buyer.name}</option>)}
            </select>
          </Field>
        )}
      </form>
    </Modal>
  );
}

export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [toggling, setToggling] = useState(null); // { user, busy }
  const { filters, set, clear, query, active } = useFilters(NO_FILTERS);
  const users = useApiQuery(() => usersApi.list({ ...query, limit: 100 }), [query]);
  // All companies for the name column (a deactivated company's users still need a name);
  // only active ones can receive a new account.
  const buyers = useApiQuery(() => buyersApi.list({ limit: 100 }), []);
  const buyerName = (id) => buyers.data?.buyers.find((buyer) => buyer.id === id)?.code ?? '—';
  const activeBuyers = (buyers.data?.buyers ?? []).filter((buyer) => buyer.isActive);
  const list = users.data?.users ?? [];

  async function confirmToggle() {
    const target = toggling.user;
    setToggling({ ...toggling, busy: true });
    try {
      await usersApi.setStatus(target.id, !target.isActive);
      toast.success(target.isActive ? `${target.name} deactivated. Their sessions ended immediately.` : `${target.name} reactivated.`);
      setToggling(null);
      users.reload();
    } catch (error) {
      toast.error(error, { title: 'Status not changed' });
      setToggling(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle="Accounts and roles. Permissions are enforced by the server on every request."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Users' }]}
        actions={
          <button type="button" className="erp-btn-primary" onClick={() => setCreating(true)}>
            <Plus size={15} aria-hidden="true" /> Create account
          </button>
        }
      />
      <div className="erp-card">
        <FilterBar active={active} onClear={clear} label="User filters">
          <SearchInput id="user-search" value={filters.q} onChange={(value) => set('q', value)} placeholder="Search name or email" />
          <FilterSelect
            id="role-filter"
            label="Role"
            value={filters.role}
            onChange={(value) => set('role', value)}
            allLabel="All roles"
            options={Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <FilterSelect id="user-status-filter" label="Status" value={filters.isActive} onChange={(value) => set('isActive', value)} options={STATUS_OPTIONS} />
        </FilterBar>
        {users.error && <ErrorState error={users.error} onRetry={users.reload} />}
        {!users.error && !users.data && <LoadingState label="Loading accounts…" />}
        {users.data && list.length === 0 && (
          <EmptyState title={active ? 'No accounts match these filters' : 'No accounts'} action={active ? <button type="button" className="erp-btn-outline" onClick={clear}>Clear filters</button> : null} />
        )}
        {list.length > 0 && (
          <div className="erp-table-wrapper">
            <table className="erp-data-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Buyer company</th>
                  <th scope="col">Last sign-in</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {list.map((account) => (
                  <tr key={account.id}>
                    <td className="table-primary-cell">{account.name}{account.id === me.id && <span className="cell-sub"> (you)</span>}</td>
                    <td>{account.email}</td>
                    <td><span className="erp-status-badge neutral">{ROLE_LABELS[account.role]}</span></td>
                    <td>{account.role === ROLES.BUYER ? (account.buyerId ? buyerName(account.buyerId) : <span className="deadline-chip overdue">Not linked</span>) : '—'}</td>
                    <td>{account.lastLoginAt ? formatDateTime(account.lastLoginAt) : 'Never'}</td>
                    <td><span className={`erp-status-badge ${account.isActive ? 'active' : 'error'}`}>{account.isActive ? 'Active' : 'Deactivated'}</span></td>
                    <td>
                      {account.id !== me.id && (
                        <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setToggling({ user: account, busy: false })}>
                          {account.isActive ? 'Deactivate' : 'Reactivate'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ListLimitNotice shown={list.length} total={users.meta?.total} />
      </div>
      {creating && (
        <CreateUserModal
          buyers={activeBuyers}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            users.reload();
          }}
        />
      )}
      {toggling && (
        <ConfirmDialog
          title={toggling.user.isActive ? `Deactivate ${toggling.user.name}?` : `Reactivate ${toggling.user.name}?`}
          message={
            toggling.user.isActive
              ? 'They are signed out everywhere at once and cannot sign in until reactivated. Their history is kept.'
              : 'They will be able to sign in again with their existing password.'
          }
          confirmLabel={toggling.user.isActive ? 'Deactivate' : 'Reactivate'}
          danger={toggling.user.isActive}
          busy={toggling.busy}
          onConfirm={confirmToggle}
          onClose={() => setToggling(null)}
        />
      )}
    </div>
  );
}
