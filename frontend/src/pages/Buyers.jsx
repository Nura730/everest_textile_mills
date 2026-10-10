import { useState } from 'react';
import { Plus } from 'lucide-react';
import { fieldErrorsOf } from '../api/client.js';
import { buyersApi } from '../api/endpoints.js';
import { Field, Modal } from '../components/ui/Modal.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, ListLimitNotice, LoadingState } from '../components/ui/States.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { formatDate } from '../utils/format.js';

const EMPTY = { code: '', name: '', contactName: '', email: '', phone: '', address: '' };

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
  const [creating, setCreating] = useState(false);
  const buyers = useApiQuery(() => buyersApi.list({ limit: 100 }), []);
  const list = buyers.data?.buyers ?? [];

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
        {buyers.error && <ErrorState error={buyers.error} onRetry={buyers.reload} />}
        {!buyers.error && !buyers.data && <LoadingState label="Loading buyers…" />}
        {buyers.data && list.length === 0 && <EmptyState title="No buyer companies yet">Add the first buyer company to start taking orders.</EmptyState>}
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ListLimitNotice shown={list.length} total={buyers.meta?.total} />
      </div>
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
