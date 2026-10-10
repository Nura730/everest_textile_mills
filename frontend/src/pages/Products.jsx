import { useState } from 'react';
import { Plus } from 'lucide-react';
import { fieldErrorsOf } from '../api/client.js';
import { productsApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ROLES, can } from '../auth/roles.js';
import { CreateOrderModal } from '../components/orders/CreateOrderModal.jsx';
import { FilterBar, FilterSelect, SearchInput } from '../components/ui/Filters.jsx';
import { ConfirmDialog, Field, Modal } from '../components/ui/Modal.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, ListLimitNotice, LoadingState } from '../components/ui/States.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useFilters } from '../hooks/useFilters.js';
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

/**
 * Edit a fabric's name, price and yarn consumption (ADMIN). Code, material, colour, weave, width and
 * GSM define which fabric it is, so they are shown read-only: a different fabric is a new product.
 * Changes apply to orders placed from now on; existing orders keep the price and yarn figure copied
 * onto them when they were placed.
 */
function EditProductModal({ product, onClose, onSaved, onStale }) {
  const toast = useToast();
  const initial = { name: product.name, priceRupees: (product.pricePerMetrePaise / 100).toFixed(2), yarnGramsPerMetre: String(product.yarnGramsPerMetre) };
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const minYarn = Math.floor((product.gsm * product.widthCm) / 100);
  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const price = rupeesToPaise(form.priceRupees);
    const yarn = Number(form.yarnGramsPerMetre);
    const found = {};
    if (form.name.trim().length < 2) found.name = 'Enter the fabric name.';
    if (!price) found.pricePerMetrePaise = 'Enter a price per metre above ₹0, at most 2 decimals (e.g. 180.50).';
    if (!Number.isInteger(yarn) || yarn < minYarn) found.yarnGramsPerMetre = `Whole grams, at least ${minYarn} g (the fabric's own weight per metre).`;
    setErrors(found);
    if (Object.keys(found).length) return;

    const changes = {};
    if (form.name.trim() !== product.name) changes.name = form.name.trim();
    if (price !== product.pricePerMetrePaise) changes.pricePerMetrePaise = price;
    if (yarn !== product.yarnGramsPerMetre) changes.yarnGramsPerMetre = yarn;
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      const { data } = await productsApi.update(product.id, { ...changes, expectedUpdatedAt: product.updatedAt });
      toast.success(`${data.product.code} updated. New orders use the new figures.`);
      onSaved(data.product);
    } catch (error) {
      if (error.code === 'CONFLICT') {
        toast.error(error, { title: 'Changed by someone else' });
        onStale();
      } else {
        const fields = fieldErrorsOf(error);
        setErrors(fields);
        if (!Object.keys(fields).length) toast.error(error, { title: 'Fabric not updated' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Edit ${product.code}`}
      subtitle="Applies to new orders. Existing orders keep the figures they were placed with."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="edit-product-form" className="erp-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
        </>
      }
    >
      <form id="edit-product-form" className="erp-form-grid" onSubmit={onSubmit} noValidate>
        <div className="readonly-grid" aria-label="Fixed fabric definition">
          <div><span>Code</span>{product.code}</div>
          <div><span>Material · colour</span>{product.material} · {product.colour}</div>
          <div><span>Weave</span>{product.weave}</div>
          <div><span>Width</span>{product.widthCm} cm</div>
          <div><span>GSM</span>{product.gsm}</div>
          <div><span>Fixed</span>Define the fabric</div>
        </div>
        <Field label="Name" htmlFor="ep-name" error={errors.name} required>
          <input id="ep-name" className="erp-input" value={form.name} onChange={update('name')} disabled={busy} />
        </Field>
        <Field label="Price per metre (₹)" htmlFor="ep-price" error={errors.pricePerMetrePaise} required>
          <input id="ep-price" className="erp-input" inputMode="decimal" value={form.priceRupees} onChange={update('priceRupees')} disabled={busy} />
        </Field>
        <Field label="Yarn per metre (g)" htmlFor="ep-yarn" error={errors.yarnGramsPerMetre} hint={`Including process waste. At least ${minYarn} g.`} required>
          <input id="ep-yarn" className="erp-input" inputMode="numeric" value={form.yarnGramsPerMetre} onChange={update('yarnGramsPerMetre')} disabled={busy} />
        </Field>
      </form>
    </Modal>
  );
}

const NO_FILTERS = { q: '', material: '', colour: '', weave: '', isActive: '' };

export default function Products() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [editing, setEditing] = useState(null); // product
  const [toggling, setToggling] = useState(null); // { product, busy }
  const isAdmin = user.role === ROLES.ADMIN;
  const { filters, set, clear, query, active } = useFilters(NO_FILTERS);
  // An admin sees every status unless a status is picked; everyone else only ever gets active fabrics.
  const products = useApiQuery(
    () => productsApi.list({ ...query, ...(isAdmin && !query.isActive ? { includeInactive: true } : {}), limit: 100 }),
    [query, isAdmin],
  );
  // Colour choices come from the catalog itself, so only colours that exist are offered.
  const colourSource = useApiQuery(() => productsApi.list({ limit: 100, includeInactive: isAdmin }), [isAdmin]);
  const colours = [...new Set((colourSource.data?.products ?? []).map((product) => product.colour))].sort();
  const list = products.data?.products ?? [];
  const showsSpec = list.some((product) => product.yarnGramsPerMetre !== undefined);

  async function confirmToggle() {
    const target = toggling.product;
    setToggling({ ...toggling, busy: true });
    try {
      await productsApi.setStatus(target.id, !target.isActive);
      toast.success(target.isActive ? `${target.code} retired. It can no longer be ordered.` : `${target.code} is orderable again.`);
    } catch (error) {
      toast.error(error, { title: 'Status not changed' });
    } finally {
      setToggling(null);
      products.reload();
    }
  }

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
        <FilterBar active={active} onClear={clear} label="Catalog filters">
          <SearchInput id="product-search" value={filters.q} onChange={(value) => set('q', value)} placeholder="Search code or fabric name" />
          <FilterSelect id="material-filter" label="Material" value={filters.material} onChange={(value) => set('material', value)} options={MATERIALS.map((m) => ({ value: m, label: m }))} />
          <FilterSelect id="colour-filter" label="Colour" value={filters.colour} onChange={(value) => set('colour', value)} options={colours.map((c) => ({ value: c, label: c }))} />
          <FilterSelect id="weave-filter" label="Weave" value={filters.weave} onChange={(value) => set('weave', value)} options={WEAVES.map((w) => ({ value: w, label: w }))} />
          {isAdmin && (
            <FilterSelect
              id="product-status-filter"
              label="Status"
              value={filters.isActive}
              onChange={(value) => set('isActive', value)}
              options={[{ value: 'true', label: 'Active' }, { value: 'false', label: 'Retired' }]}
            />
          )}
        </FilterBar>
        {products.error && <ErrorState error={products.error} onRetry={products.reload} />}
        {!products.error && !products.data && <LoadingState label="Loading catalog…" />}
        {products.data && list.length === 0 && (active ? (
          <EmptyState title="No fabrics match these filters" action={<button type="button" className="erp-btn-outline" onClick={clear}>Clear filters</button>} />
        ) : (
          <EmptyState title="The catalog is empty">
            {can.manageProducts(user.role) ? 'Add the first fabric to start taking orders.' : 'No fabrics are available to order yet.'}
          </EmptyState>
        ))}
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
                  {isAdmin && <th scope="col"><span className="sr-only">Actions</span></th>}
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
                    {isAdmin && (
                      <td className="row-actions">
                        <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setEditing(product)}>Edit</button>
                        <button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setToggling({ product, busy: false })}>
                          {product.isActive ? 'Retire' : 'Reactivate'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <ListLimitNotice shown={list.length} total={products.meta?.total} />
      </div>
      {editing && (
        <EditProductModal
          product={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            products.reload();
          }}
          onStale={() => {
            setEditing(null);
            products.reload();
          }}
        />
      )}
      {toggling && (
        <ConfirmDialog
          title={toggling.product.isActive ? `Retire ${toggling.product.code}?` : `Reactivate ${toggling.product.code}?`}
          message={
            toggling.product.isActive
              ? `${toggling.product.name} will no longer be offered for new orders. Existing orders for it continue unchanged.`
              : `${toggling.product.name} will be orderable again.`
          }
          confirmLabel={toggling.product.isActive ? 'Retire' : 'Reactivate'}
          danger={toggling.product.isActive}
          busy={toggling.busy}
          onConfirm={confirmToggle}
          onClose={() => setToggling(null)}
        />
      )}
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
