import { useState } from 'react';
import { Plus } from 'lucide-react';
import { fieldErrorsOf } from '../api/client.js';
import { buyersApi } from '../api/endpoints.js';
import { FilterBar, FilterSelect, SearchInput } from '../components/ui/Filters.jsx';
import { ConfirmDialog, Field, Modal } from '../components/ui/Modal.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, ListLimitNotice, LoadingState } from '../components/ui/States.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useFilters } from '../hooks/useFilters.js';
import { formatDate } from '../utils/format.js';

const EMPTY = { code: '', name: '', contactName: '', email: '', phone: '', address: '' };
const NO_FILTERS = { q: '', isActive: '' };
const CONTACT_FIELDS = ['contactName', 'email', 'phone', 'address'];

/**
 * Edit a company's contact details. The code is its stable identifier and is shown read-only.
 * Only changed fields are sent; a cleared optional field is sent as null. The record's updatedAt
 * goes along, so the server refuses the save if someone else changed the company meanwhile.
 */
function EditBuyerModal({ buyer, onClose, onSaved, onStale }) {
  const toast = useToast();
  const initial = { name: buyer.name, ...Object.fromEntries(CONTACT_FIELDS.map((field) => [field, buyer[field] ?? ''])) };
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
  };

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    if (form.name.trim().length < 2) {
      setErrors({ name: 'Enter the company name.' });
      return;
    }
    const changes = {};
    for (const [field, value] of Object.entries(form)) {
      const next = value.trim();
      if (next === (initial[field] ?? '').trim()) continue;
      changes[field] = next === '' && field !== 'name' ? null : next;
    }
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      const { data } = await buyersApi.update(buyer.id, { ...changes, expectedUpdatedAt: buyer.updatedAt });
      toast.success(`${data.buyer.code} updated.`);
      onSaved(data.buyer);
    } catch (error) {
      if (error.code === 'CONFLICT') {
        toast.error(error, { title: 'Changed by someone else' });
        onStale();
      } else {
        const fields = fieldErrorsOf(error);
        setErrors(fields);
        if (!Object.keys(fields).length) toast.error(error, { title: 'Buyer not updated' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Edit ${buyer.code}`}
      subtitle="Existing orders keep the company name they were placed with."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="edit-buyer-form" className="erp-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </>
      }
    >
      <form id="edit-buyer-form" className="erp-form-grid" onSubmit={onSubmit} noValidate>
        <Field label="Code" htmlFor="eb-code" hint="The company's identifier; it cannot be changed.">
          <input id="eb-code" className="erp-input" value={buyer.code} readOnly disabled />
        </Field>
        <Field label="Company name" htmlFor="eb-name" error={errors.name} required>
          <input id="eb-name" className="erp-input" value={form.name} onChange={update('name')} disabled={busy} />
        </Field>
        <Field label="Contact person" htmlFor="eb-contact" error={errors.contactName}>
          <input id="eb-contact" className="erp-input" value={form.contactName} onChange={update('contactName')} disabled={busy} />
        </Field>
        <Field label="Email" htmlFor="eb-email" error={errors.email}>
          <input id="eb-email" type="email" className="erp-input" value={form.email} onChange={update('email')} disabled={busy} />
        </Field>
        <Field label="Phone" htmlFor="eb-phone" error={errors.phone}>
          <input id="eb-phone" className="erp-input" value={form.phone} onChange={update('phone')} disabled={busy} placeholder="+91 98250 12345" />
        </Field>
        <Field label="Address" htmlFor="eb-address" error={errors.address} hint="Leave a field empty to remove it.">
          <textarea id="eb-address" className="erp-input" rows={2} value={form.address} onChange={update('address')} disabled={busy} />
        </Field>
      </form>
    </Modal>
  );
}

function CreateBuyerModal({ onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
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
    if (form.code.trim().length < 2) found.code = 'Enter a short code, e.g. BUY-SRT.';
    if (form.name.trim().length < 2) found.name = 'Enter the company name.';
    setErrors(found);
    if (Object.keys(found).length) return;

    // Optional fields are sent only when filled (the backend rejects empty strings for them).
    const body = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim()]).filter(([, value]) => value));
    setBusy(true);
    try {
      const { data } = await buyersApi.create(body);
      toast.success(`Buyer ${data.buyer.code} created. Create a login for them in Users.`);
      onCreated(data.buyer);
    } catch (error) {
      if (error.code === 'DUPLICATE_RESOURCE') setErrors({ code: 'This code is already used by another buyer.' });
      else {
        const fields = fieldErrorsOf(error);
        setErrors(fields);
        if (!Object.keys(fields).length) toast.error(error, { title: 'Buyer not created' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add buyer company"
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="buyer-form" className="erp-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Add buyer'}</button>
        </>
      }
    >
      <form id="buyer-form" className="erp-form-grid" onSubmit={onSubmit} noValidate>
        <Field label="Code" htmlFor="b-code" error={errors.code} hint="Unique, e.g. BUY-SRT" required>
          <input id="b-code" className="erp-input" value={form.code} onChange={update('code')} disabled={busy} />
        </Field>
        <Field label="Company name" htmlFor="b-name" error={errors.name} required>
          <input id="b-name" className="erp-input" value={form.name} onChange={update('name')} disabled={busy} />
        </Field>
        <Field label="Contact person" htmlFor="b-contact" error={errors.contactName}>
          <input id="b-contact" className="erp-input" value={form.contactName} onChange={update('contactName')} disabled={busy} />
        </Field>
        <Field label="Email" htmlFor="b-email" error={errors.email}>
          <input id="b-email" type="email" className="erp-input" value={form.email} onChange={update('email')} disabled={busy} />
        </Field>
        <Field label="Phone" htmlFor="b-phone" error={errors.phone}>
          <input id="b-phone" className="erp-input" value={form.phone} onChange={update('phone')} disabled={busy} placeholder="+91 98250 12345" />
        </Field>
        <Field label="Address" htmlFor="b-address" error={errors.address}>
          <textarea id="b-address" className="erp-input" rows={2} value={form.address} onChange={update('address')} disabled={busy} />
        </Field>
      </form>
    </Modal>
  );
}

export default function Buyers() {
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null); // buyer
  const [toggling, setToggling] = useState(null); // { buyer, busy }
  const { filters, set, clear, query, active } = useFilters(NO_FILTERS);
  const buyers = useApiQuery(() => buyersApi.list({ ...query, limit: 100 }), [query]);
  const list = buyers.data?.buyers ?? [];

  async function confirmToggle() {
    const target = toggling.buyer;
    setToggling({ ...toggling, busy: true });
    try {
      await buyersApi.setStatus(target.id, !target.isActive);
      toast.success(target.isActive ? `${target.code} deactivated. It can no longer place orders.` : `${target.code} reactivated.`);
    } catch (error) {
      toast.error(error, { title: 'Status not changed' });
    } finally {
      setToggling(null);
      buyers.reload();
    }
  }

  return (
    <div>
      <PageHeader
        title="Buyers"
        subtitle="Buyer companies. Each company's users see only that company's orders."
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Buyers' }]}
        actions={
          <button type="button" className="erp-btn-primary" onClick={() => setCreating(true)}>
            <Plus size={15} aria-hidden="true" /> Add buyer
          </button>
        }
      />
      <div className="erp-card">
        <FilterBar active={active} onClear={clear} label="Buyer filters">
          <SearchInput id="buyer-search" value={filters.q} onChange={(value) => set('q', value)} placeholder="Search code or company" />
          <FilterSelect
            id="buyer-status-filter"
            label="Status"
            value={filters.isActive}
            onChange={(value) => set('isActive', value)}
            options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Inactive' }]}
          />
        </FilterBar>
        {buyers.error && <ErrorState error={buyers.error} onRetry={buyers.reload} />}
        {!buyers.error && !buyers.data && <LoadingState label="Loading buyers…" />}
        {buyers.data && list.length === 0 && (active ? (
          <EmptyState title="No buyers match these filters" action={<button type="button" className="erp-btn-outline" onClick={clear}>Clear filters</button>} />
        ) : (
          <EmptyState title="No buyer companies yet">Add the first buyer company to start taking orders.</EmptyState>
        ))}
        {list.length > 0 && (
          <div className="erp-table-wrapper">
            <table className="erp-data-table">
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Company</th>
                  <th scope="col">Contact</th>
                  <th scope="col">Email / phone</th>
                  <th scope="col">Status</th>
                  <th scope="col">Added</th>
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {list.map((buyer) => (
                  <tr key={buyer.id}>
                    <td className="mono">{buyer.code}</td>
                    <td className="table-primary-cell">{buyer.name}</td>
                    <td>{buyer.contactName ?? '—'}</td>
                    <td>
                      {buyer.email ?? '—'}
                      {buyer.phone && <div className="cell-sub">{buyer.phone}</div>}
                    </td>
                    <td><span className={`erp-status-badge ${buyer.isActive ? 'active' : 'error'}`}>{buyer.isActive ? 'Active' : 'Inactive'}</span></td>
                    <td>{formatDate(buyer.createdAt)}</td>
                    <td className="row-actions">
                      <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setEditing(buyer)}>Edit</button>
                      <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setToggling({ buyer, busy: false })}>
                        {buyer.isActive ? 'Deactivate' : 'Reactivate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ListLimitNotice shown={list.length} total={buyers.meta?.total} />
      </div>
      {editing && (
        <EditBuyerModal
          buyer={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            buyers.reload();
          }}
          onStale={() => {
            setEditing(null);
            buyers.reload();
          }}
        />
      )}
      {toggling && (
        <ConfirmDialog
          title={toggling.buyer.isActive ? `Deactivate ${toggling.buyer.code}?` : `Reactivate ${toggling.buyer.code}?`}
          message={
            toggling.buyer.isActive
              ? `${toggling.buyer.name} will not be able to place new orders. Existing orders, its user accounts and their history stay as they are.`
              : `${toggling.buyer.name} will be able to place orders again.`
          }
          confirmLabel={toggling.buyer.isActive ? 'Deactivate' : 'Reactivate'}
          danger={toggling.buyer.isActive}
          busy={toggling.busy}
          onConfirm={confirmToggle}
          onClose={() => setToggling(null)}
        />
      )}
      {creating && (
        <CreateBuyerModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            buyers.reload();
          }}
        />
      )}
    </div>
  );
}
