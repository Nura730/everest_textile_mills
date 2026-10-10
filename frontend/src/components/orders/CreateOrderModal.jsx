import { useMemo, useState } from 'react';
import { fieldErrorsOf, newIdempotencyKey } from '../../api/client.js';
import { buyersApi, ordersApi, productsApi } from '../../api/endpoints.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { ROLES } from '../../auth/roles.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { runOrQueue } from '../../offline/syncManager.js';
import { addDays, addYears, formatPaise, todayInIndia } from '../../utils/format.js';
import { Field, Modal } from '../ui/Modal.jsx';
import { ErrorState, LoadingState } from '../ui/States.jsx';
import { useToast } from '../ui/Toast.jsx';

// The backend's limits (validators/order.validators.js), checked here too so the user sees them first.
const MAX_ORDER_METRES = 1_000_000;
const MAX_DEADLINE_YEARS = 2;

/**
 * Place an order. A BUYER orders for their own company (the backend takes it from the account and
 * rejects a buyerId in the body); an ADMIN picks the buyer company.
 */
export function CreateOrderModal({ onClose, onCreated }) {
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user.role === ROLES.ADMIN;

  // Cached so an order can be placed offline from the last known catalog; the server re-checks it.
  const products = useApiQuery(() => productsApi.list({ limit: 100 }), [], { cacheKey: 'products:orderable' });
  const buyers = useApiQuery(() => (isAdmin ? buyersApi.list({ isActive: true, limit: 100 }) : Promise.resolve({ data: { buyers: [] } })), [isAdmin], { cacheKey: isAdmin ? 'buyers:active' : undefined });

  const [form, setForm] = useState({ productId: '', buyerId: '', quantityMetres: '', requiredBy: addDays(todayInIndia(), 30), buyerNotes: '' });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  // One key per order attempt: a retry after a timeout re-sends the SAME key, so the backend can
  // never create the order twice. A new key is made only after an edit or a success.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
    setIdempotencyKey(newIdempotencyKey());
  };

  const product = useMemo(
    () => products.data?.products.find((candidate) => candidate.id === form.productId),
    [products.data, form.productId],
  );
  const quantity = Number(form.quantityMetres);
  // Display only; the authoritative value is computed by the server and shown after creation.
  const estimatedValue = product && quantity > 0 ? Math.round(quantity * product.pricePerMetrePaise) : null;

  function validate() {
    const found = {};
    if (!form.productId) found.productId = 'Choose a fabric.';
    if (isAdmin && !form.buyerId) found.buyerId = 'Choose the buyer company.';
    if (!(quantity > 0)) found.quantityMetres = 'Enter a quantity greater than 0.';
    else if (!/^\d+(\.\d{1,2})?$/.test(form.quantityMetres.trim())) found.quantityMetres = 'Use at most 2 decimal places.';
    else if (quantity > MAX_ORDER_METRES) found.quantityMetres = `At most ${MAX_ORDER_METRES.toLocaleString('en-IN')} m per order.`;
    if (!form.requiredBy) found.requiredBy = 'Choose the delivery date.';
    else if (form.requiredBy <= todayInIndia()) found.requiredBy = 'The date must be after today.';
    else if (form.requiredBy > addYears(todayInIndia(), MAX_DEADLINE_YEARS)) found.requiredBy = `The date must be within ${MAX_DEADLINE_YEARS} years.`;
    return found;
  }

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const body = {
      productId: form.productId,
      quantityMetres: quantity,
      requiredBy: form.requiredBy,
      ...(form.buyerNotes.trim() ? { buyerNotes: form.buyerNotes.trim() } : {}),
      ...(isAdmin ? { buyerId: form.buyerId } : {}),
    };

    setBusy(true);
    try {
      const fabric = products.data.products.find((p) => p.id === form.productId);
      const sent = await runOrQueue(
        { key: idempotencyKey, type: 'ORDER_CREATE', payload: body, label: `New order: ${quantity.toLocaleString('en-IN')} m ${fabric?.name ?? ''}`.trim(), ref: { newOrder: true }, userId: user.id },
        (k) => ordersApi.create(body, k),
      );
      if (sent.queued) {
        // Stored on this device only: no order number yet, nothing created on the server.
        toast.info('Saved offline — waiting to sync. The order gets its number when it reaches the server.', { title: 'Saved on this device' });
        onClose();
        return;
      }
      const { data, replayed } = sent.result;
      toast.success(
        replayed
          ? `Order ${data.order.orderNumber} was already created — showing the existing order.`
          : `Order ${data.order.orderNumber} created successfully.`,
      );
      onCreated(data.order);
    } catch (error) {
      const fields = fieldErrorsOf(error);
      setErrors(fields);
      if (Object.keys(fields).length === 0 || fields.form) toast.error(error, { title: 'Order not created' });
    } finally {
      setBusy(false);
    }
  }

  const loading = products.loading || buyers.loading;
  const loadError = products.error || buyers.error;

  return (
    <Modal
      title="Place an order"
      subtitle={isAdmin ? 'Order on behalf of a buyer company.' : 'The order is placed for your company.'}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="create-order-form" className="erp-btn-primary" disabled={busy || loading || Boolean(loadError)}>
            {busy ? 'Placing order…' : 'Place order'}
          </button>
        </>
      }
    >
      {loading && <LoadingState label="Loading catalog…" />}
      {loadError && <ErrorState error={loadError} onRetry={() => { products.reload(); buyers.reload(); }} />}
      {!loading && !loadError && (
        <form id="create-order-form" className="erp-form-grid" onSubmit={onSubmit} noValidate>
          {isAdmin && (
            <Field label="Buyer company" htmlFor="order-buyer" error={errors.buyerId} required>
              <select id="order-buyer" className="erp-input" value={form.buyerId} onChange={update('buyerId')} disabled={busy}>
                <option value="">Select a buyer…</option>
                {buyers.data.buyers.map((buyer) => (
                  <option key={buyer.id} value={buyer.id}>{buyer.code} — {buyer.name}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Fabric" htmlFor="order-product" error={errors.productId} required>
            <select id="order-product" className="erp-input" value={form.productId} onChange={update('productId')} disabled={busy}>
              <option value="">Select from the catalog…</option>
              {products.data.products.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} ({option.code}) — {formatPaise(option.pricePerMetrePaise)}/m
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity (metres)" htmlFor="order-qty" error={errors.quantityMetres} hint="Up to 1,000,000 m, at most 2 decimals." required>
            <input id="order-qty" className="erp-input" inputMode="decimal" value={form.quantityMetres} onChange={update('quantityMetres')} disabled={busy} placeholder="5000" />
          </Field>
          <Field label="Required by" htmlFor="order-date" error={errors.requiredBy} hint="Delivery date (India calendar). After today, within 2 years." required>
            <input id="order-date" type="date" className="erp-input" min={addDays(todayInIndia(), 1)} max={addYears(todayInIndia(), MAX_DEADLINE_YEARS)} value={form.requiredBy} onChange={update('requiredBy')} disabled={busy} />
          </Field>
          <Field label="Notes for the factory (optional)" htmlFor="order-notes" error={errors.buyerNotes}>
            <textarea id="order-notes" className="erp-input" rows={2} maxLength={500} value={form.buyerNotes} onChange={update('buyerNotes')} disabled={busy} placeholder="e.g. Pack in 100 m rolls" />
          </Field>
          {estimatedValue !== null && (
            <div className="form-notice-box">
              Estimated value: <strong>{formatPaise(estimatedValue)}</strong> ({quantity.toLocaleString('en-IN')} m ×{' '}
              {formatPaise(product.pricePerMetrePaise)}). The final value is calculated by the server.
            </div>
          )}
        </form>
      )}
    </Modal>
  );
}
