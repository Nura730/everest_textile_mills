import { useState } from 'react';
import { Plus } from 'lucide-react';
import { fieldErrorsOf } from '../api/client.js';
import { productsApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ROLES, can } from '../auth/roles.js';
import { CreateOrderModal } from '../components/orders/CreateOrderModal.jsx';
import { Field, Modal } from '../components/ui/Modal.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, ListLimitNotice, LoadingState } from '../components/ui/States.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { formatPaise, rupeesToPaise } from '../utils/format.js';
import { useNavigate } from 'react-router-dom';

const MATERIALS = ['COTTON', 'POLYESTER', 'VISCOSE', 'NYLON', 'WOOL', 'SILK', 'LINEN', 'BLEND'];
const WEAVES = ['PLAIN', 'TWILL', 'SATIN', 'DOBBY'];
const EMPTY = { code: '', name: '', material: 'COTTON', colour: '', weave: 'PLAIN', widthCm: '150', gsm: '110', yarnGramsPerMetre: '170', priceRupees: '' };

function CreateProductModal({ onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };
  // Same rule the backend enforces, shown as a hint while typing.
  const minYarn = Math.floor((Number(form.gsm) * Number(form.widthCm)) / 100) || 0;

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const pricePerMetrePaise = rupeesToPaise(form.priceRupees);
    const found = {};
    if (!pricePerMetrePaise) found.pricePerMetrePaise = 'Enter a price per metre above ₹0, at most 2 decimals (e.g. 180.50).';
    if (!form.colour.trim()) found.colour = 'Enter the colour.';
    setErrors(found);
    if (Object.keys(found).length) return;

    const body = {
      code: form.code,
      name: form.name,
      material: form.material,
      colour: form.colour,
      weave: form.weave,
      widthCm: Number(form.widthCm),
      gsm: Number(form.gsm),
      yarnGramsPerMetre: Number(form.yarnGramsPerMetre),
      pricePerMetrePaise,
    };
    setBusy(true);
    try {
      const { data } = await productsApi.create(body);
      toast.success(`Fabric ${data.product.code} added to the catalog.`);
      onCreated(data.product);
    } catch (error) {
      if (error.code === 'DUPLICATE_RESOURCE') setErrors({ code: 'This product code already exists.' });
      else {
        const fields = fieldErrorsOf(error);
        setErrors(fields);
        if (!Object.keys(fields).length) toast.error(error, { title: 'Product not added' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add catalog fabric"
      subtitle="Yarn grams per metre drives material planning for every order of this fabric."
      onClose={onClose}
      busy={busy}
      wide
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="product-form" className="erp-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Add fabric'}</button>
        </>
      }
    >
      <form id="product-form" className="erp-form-grid two-col" onSubmit={onSubmit} noValidate>
        <Field label="Code" htmlFor="p-code" error={errors.code} hint="e.g. COT-NAVY-PLAIN" required>
          <input id="p-code" className="erp-input" value={form.code} onChange={update('code')} disabled={busy} />
        </Field>
        <Field label="Name" htmlFor="p-name" error={errors.name} required>
          <input id="p-name" className="erp-input" value={form.name} onChange={update('name')} disabled={busy} />
        </Field>
        <Field label="Material" htmlFor="p-material" error={errors.material} required>
          <select id="p-material" className="erp-input" value={form.material} onChange={update('material')} disabled={busy}>
            {MATERIALS.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Colour" htmlFor="p-colour" error={errors.colour} required>
          <input id="p-colour" className="erp-input" value={form.colour} onChange={update('colour')} disabled={busy} placeholder="Navy" />
        </Field>
        <Field label="Weave" htmlFor="p-weave" error={errors.weave} required>
          <select id="p-weave" className="erp-input" value={form.weave} onChange={update('weave')} disabled={busy}>
            {WEAVES.map((w) => <option key={w}>{w}</option>)}
          </select>
        </Field>
        <Field label="Width (cm)" htmlFor="p-width" error={errors.widthCm} hint="50–400" required>
          <input id="p-width" className="erp-input" inputMode="numeric" value={form.widthCm} onChange={update('widthCm')} disabled={busy} />
        </Field>
        <Field label="GSM (g/m²)" htmlFor="p-gsm" error={errors.gsm} hint="20–1000" required>
          <input id="p-gsm" className="erp-input" inputMode="numeric" value={form.gsm} onChange={update('gsm')} disabled={busy} />
        </Field>
        <Field label="Yarn per metre (g)" htmlFor="p-yarn" error={errors.yarnGramsPerMetre} hint={`Including process waste. At least ${minYarn} g (fabric weight per metre).`} required>
          <input id="p-yarn" className="erp-input" inputMode="numeric" value={form.yarnGramsPerMetre} onChange={update('yarnGramsPerMetre')} disabled={busy} />
        </Field>
        <Field label="Price per metre (₹)" htmlFor="p-price" error={errors.pricePerMetrePaise} required>
          <input id="p-price" className="erp-input" inputMode="decimal" value={form.priceRupees} onChange={update('priceRupees')} disabled={busy} placeholder="180.00" />
        </Field>
      </form>
    </Modal>
  );
}

export default function Products() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const isAdmin = user.role === ROLES.ADMIN;
  const products = useApiQuery(() => productsApi.list({ limit: 100, includeInactive: isAdmin }), [isAdmin]);
  const list = products.data?.products ?? [];
  const showsSpec = list.some((product) => product.yarnGramsPerMetre !== undefined);

  return (
    <div>
      <PageHeader
        title="Fabric catalog"
        subtitle={
          user.role === ROLES.BUYER
            ? 'Fabrics you can order, with the current price per metre.'
            : 'Catalog fabrics with the yarn consumption used for material planning.'
        }
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Fabric catalog' }]}
        actions={
          <>
            {can.createOrder(user.role) && list.length > 0 && (
              <button type="button" className="erp-btn-outline" onClick={() => setOrdering(true)}>Place order</button>
            )}
            {can.manageProducts(user.role) && (
              <button type="button" className="erp-btn-primary" onClick={() => setCreating(true)}>
                <Plus size={15} aria-hidden="true" /> Add fabric
              </button>
            )}
          </>
        }
      />
      <div className="erp-card">
        {products.error && <ErrorState error={products.error} onRetry={products.reload} />}
        {!products.error && !products.data && <LoadingState label="Loading catalog…" />}
        {products.data && list.length === 0 && (
          <EmptyState title="The catalog is empty">
            {can.manageProducts(user.role) ? 'Add the first fabric to start taking orders.' : 'No fabrics are available to order yet.'}
          </EmptyState>
        )}
        {list.length > 0 && (
          <div className="erp-table-wrapper">
            <table className="erp-data-table">
              <thead>
                <tr>
                  <th scope="col">Code</th>
                  <th scope="col">Fabric</th>
                  <th scope="col">Material · colour</th>
                  <th scope="col">Weave</th>
                  <th scope="col" className="num">Width</th>
                  <th scope="col" className="num">GSM</th>
                  {showsSpec && <th scope="col" className="num">Yarn / m</th>}
                  <th scope="col" className="num">Price / m</th>
                  {isAdmin && <th scope="col">Status</th>}
                </tr>
              </thead>
              <tbody>
                {list.map((product) => (
                  <tr key={product.id}>
                    <td className="mono">{product.code}</td>
                    <td className="table-primary-cell">{product.name}</td>
                    <td>{product.material} · {product.colour}</td>
                    <td>{product.weave}</td>
                    <td className="num">{product.widthCm} cm</td>
                    <td className="num">{product.gsm}</td>
                    {showsSpec && <td className="num">{product.yarnGramsPerMetre} g</td>}
                    <td className="num">{formatPaise(product.pricePerMetrePaise)}</td>
                    {isAdmin && <td><span className={`erp-status-badge ${product.isActive ? 'active' : 'error'}`}>{product.isActive ? 'Active' : 'Retired'}</span></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ListLimitNotice shown={list.length} total={products.meta?.total} />
      </div>
      {creating && (
        <CreateProductModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            products.reload();
          }}
        />
      )}
      {ordering && (
        <CreateOrderModal onClose={() => setOrdering(false)} onCreated={(order) => navigate(`/orders/${order.id}`)} />
      )}
    </div>
  );
}
