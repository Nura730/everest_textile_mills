import { useMemo, useState } from 'react';
import { fieldErrorsOf, newIdempotencyKey } from '../../api/client.js';
import { inventoryApi, ordersApi } from '../../api/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { formatDate, formatNumber } from '../../utils/format.js';
import { Field, Modal } from '../ui/Modal.jsx';
import { EmptyState, ErrorState, LoadingState } from '../ui/States.jsx';
import { useToast } from '../ui/Toast.jsx';

const toGrams = (kg) => Math.round(Number(kg) * 1000);
const KG_PATTERN = /^\d+(\.\d{1,3})?$/;

/** Oldest lots first until the requirement is covered: the same rule the server applies. */
function fifoPlan(lots, requiredGrams) {
  const plan = {};
  let remaining = requiredGrams;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const take = Math.min(toGrams(lot.availableKg), remaining);
    if (take > 0) plan[lot.id] = String(take / 1000);
    remaining -= take;
  }
  return { plan, shortGrams: Math.max(0, remaining) };
}

const STATUS_LABELS = { ACTIVE: 'Reserved', PARTIALLY_ISSUED: 'Partly issued', FULLY_ISSUED: 'Issued', RELEASED: 'Released' };

/**
 * Reserve a confirmed order's yarn (floor manager / admin). "Oldest first" lets the server pick lots
 * FIFO; "Choose lots" sends the planner's own amounts, which must add up to the requirement.
 * Either way the server re-checks availability inside the transaction.
 */
export function ReserveModal({ order, onClose, onDone }) {
  const toast = useToast();
  const lots = useApiQuery(
    () => inventoryApi.lots({ material: order.product.material, colour: order.product.colour, limit: 100 }),
    [order.product.material, order.product.colour],
  );
  const lotList = useMemo(() => (lots.data?.lots ?? []).filter((lot) => lot.availableKg > 0), [lots.data]);
  const requiredGrams = toGrams(order.requiredYarnKg);
  const suggestion = useMemo(() => fifoPlan(lotList, requiredGrams), [lotList, requiredGrams]);
  const [mode, setMode] = useState('fifo');
  const [amounts, setAmounts] = useState(null); // { lotId: "kg" } once the user edits
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const values = amounts ?? suggestion.plan;
  const chosenGrams = Object.values(values).reduce((sum, kg) => sum + (KG_PATTERN.test(kg) ? toGrams(kg) : 0), 0);
  const availableGrams = lotList.reduce((sum, lot) => sum + toGrams(lot.availableKg), 0);

  const setAmount = (lotId, kg) => {
    setAmounts({ ...values, [lotId]: kg });
    setError(null);
    setKey(newIdempotencyKey());
  };

  async function submit() {
    if (busy) return;
    let body = {};
    if (mode === 'manual') {
      const allocations = [];
      for (const lot of lotList) {
        const kg = (values[lot.id] ?? '').trim();
        if (kg === '' || Number(kg) === 0) continue;
        if (!KG_PATTERN.test(kg)) return setError(`${lot.lotNumber}: enter kg with at most 3 decimals.`);
        if (toGrams(kg) > toGrams(lot.availableKg)) return setError(`${lot.lotNumber} has only ${formatNumber(lot.availableKg, 'kg')} available.`);
        allocations.push({ yarnLotId: lot.id, quantityKg: Number(kg) });
      }
      if (chosenGrams !== requiredGrams) return setError(`The amounts must add up to exactly ${formatNumber(order.requiredYarnKg, 'kg')}.`);
      body = { allocations };
    }
    setBusy(true);
    try {
      const { data } = await ordersApi.reserve(order.id, body, key);
      toast.success(`${formatNumber(order.requiredYarnKg, 'kg')} reserved for ${order.orderNumber} from ${data.reservations.length} lot${data.reservations.length === 1 ? '' : 's'}.`);
      onDone();
    } catch (err) {
      if (err.code === 'INSUFFICIENT_STOCK' || err.code === 'INVALID_STATE_TRANSITION') {
        // Stock or the order changed since this form loaded: show fresh numbers.
        toast.error(err, { title: 'Not reserved' });
        lots.reload();
        setAmounts(null);
        setKey(newIdempotencyKey());
      } else {
        const fields = fieldErrorsOf(err);
        setError(Object.values(fields)[0] ?? err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const enough = availableGrams >= requiredGrams;
  return (
    <Modal
      title={`Reserve yarn for ${order.orderNumber}`}
      subtitle={`${formatNumber(order.requiredYarnKg, 'kg')} of ${order.product.material} · ${order.product.colour}. Reserved yarn is no longer available to other orders.`}
      onClose={onClose}
      busy={busy}
      wide
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="erp-btn-primary" onClick={submit} disabled={busy || !lots.data || !enough}>
            {busy ? 'Reserving…' : `Reserve ${formatNumber(order.requiredYarnKg, 'kg')}`}
          </button>
        </>
      }
    >
      {lots.error && <ErrorState error={lots.error} onRetry={lots.reload} />}
      {!lots.error && !lots.data && <LoadingState label="Loading lots…" />}
      {lots.data && lotList.length === 0 && <EmptyState title="No lots with available yarn">Receive yarn of this material and colour first.</EmptyState>}
      {lots.data && lotList.length > 0 && (
        <>
          {!enough && (
            <div className="login-error" role="alert">
              Only {formatNumber(availableGrams / 1000, 'kg')} available across all lots: {formatNumber((requiredGrams - availableGrams) / 1000, 'kg')} short.
            </div>
          )}
          <div className="erp-tabs-bar" role="tablist">
            <button type="button" role="tab" aria-selected={mode === 'fifo'} className={`erp-tab-btn ${mode === 'fifo' ? 'active' : ''}`} onClick={() => setMode('fifo')}>Oldest lots first</button>
            <button type="button" role="tab" aria-selected={mode === 'manual'} className={`erp-tab-btn ${mode === 'manual' ? 'active' : ''}`} onClick={() => setMode('manual')}>Choose lots</button>
          </div>
          <table className="erp-data-table">
            <thead>
              <tr>
                <th scope="col">Lot</th>
                <th scope="col">Received</th>
                <th scope="col" className="num">Available</th>
                <th scope="col" className="num">{mode === 'fifo' ? 'Will reserve' : 'Reserve (kg)'}</th>
              </tr>
            </thead>
            <tbody>
              {lotList.map((lot) => (
                <tr key={lot.id}>
                  <td className="mono">{lot.lotNumber}</td>
                  <td>{formatDate(lot.receivedAt)}</td>
                  <td className="num">{formatNumber(lot.availableKg, 'kg')}</td>
                  <td className="num">
                    {mode === 'fifo' ? (
                      suggestion.plan[lot.id] ? formatNumber(Number(suggestion.plan[lot.id]), 'kg') : '—'
                    ) : (
                      <input
                        className="erp-input reserve-input"
                        inputMode="decimal"
                        aria-label={`Kilograms from ${lot.lotNumber}`}
                        value={values[lot.id] ?? ''}
                        onChange={(event) => setAmount(lot.id, event.target.value)}
                        disabled={busy}
                        placeholder="0"
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {mode === 'manual' && (
            <p className={`list-limit-notice ${chosenGrams === requiredGrams ? '' : 'reserve-mismatch'}`}>
              Chosen {formatNumber(chosenGrams / 1000, 'kg')} of {formatNumber(order.requiredYarnKg, 'kg')} required.
            </p>
          )}
          {error && <p className="login-field-error" role="alert">{error}</p>}
        </>
      )}
    </Modal>
  );
}

/** Issue reserved yarn to the floor, or return unused yarn to the store. */
function MoveYarnModal({ order, kind, maxKg, onClose, onDone }) {
  const toast = useToast();
  const isIssue = kind === 'issue';
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const found = {};
    const qty = quantity.trim();
    if (!KG_PATTERN.test(qty) || Number(qty) <= 0) found.quantityKg = 'Enter kg greater than 0, at most 3 decimals.';
    else if (toGrams(qty) > toGrams(maxKg)) found.quantityKg = `At most ${formatNumber(maxKg, 'kg')}.`;
    if (!isIssue && reason.trim().length < 5) found.reason = 'Give a reason of at least 5 characters.';
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      if (isIssue) await ordersApi.issue(order.id, Number(qty), key);
      else await ordersApi.returnYarn(order.id, { quantityKg: Number(qty), reason: reason.trim() }, key);
      toast.success(isIssue ? `${formatNumber(Number(qty), 'kg')} issued to production.` : `${formatNumber(Number(qty), 'kg')} returned to the store.`);
      onDone();
    } catch (error) {
      const fields = fieldErrorsOf(error);
      if (Object.keys(fields).length) setErrors(fields);
      else {
        toast.error(error, { title: isIssue ? 'Not issued' : 'Not returned' });
        if (['INSUFFICIENT_STOCK', 'QUANTITY_EXCEEDS_ISSUED', 'CONFLICT'].includes(error.code)) onDone();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={isIssue ? 'Issue yarn to production' : 'Return yarn to the store'}
      subtitle={isIssue ? `Up to ${formatNumber(maxKg, 'kg')} still reserved for ${order.orderNumber}. It leaves stock when issued.` : `Up to ${formatNumber(maxKg, 'kg')} of this order's yarn is on the floor. It goes back to the lots it came from.`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="move-yarn-form" className="erp-btn-primary" disabled={busy}>{busy ? 'Saving…' : isIssue ? 'Issue' : 'Return'}</button>
        </>
      }
    >
      <form id="move-yarn-form" className="erp-form-grid" onSubmit={onSubmit} noValidate>
        <Field label="Quantity (kg)" htmlFor="mv-qty" error={errors.quantityKg} required>
          <input
            id="mv-qty"
            className="erp-input"
            inputMode="decimal"
            value={quantity}
            onChange={(event) => { setQuantity(event.target.value); setErrors({}); setKey(newIdempotencyKey()); }}
            disabled={busy}
            placeholder={String(maxKg)}
          />
        </Field>
        {!isIssue && (
          <Field label="Reason" htmlFor="mv-reason" error={errors.reason} required>
            <textarea id="mv-reason" className="erp-input" rows={2} value={reason} onChange={(event) => { setReason(event.target.value); setErrors({}); setKey(newIdempotencyKey()); }} disabled={busy} placeholder="Unused cones back from loom 3" />
          </Field>
        )}
      </form>
    </Modal>
  );
}

/** Where this order's yarn is: per lot, reserved / issued / on the floor / released. */
/**
 * Reserve more yarn for an order in production (continuation run, remakes). Free stock only, oldest
 * lots first; the server refuses with the exact shortfall when the store does not have it.
 */
function TopUpModal({ order, onClose, onDone }) {
  const toast = useToast();
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const touch = () => { setError(null); setKey(newIdempotencyKey()); };

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const kg = Number(qty);
    if (!(kg > 0) || !/^\d+(\.\d{1,3})?$/.test(qty.trim())) return setError('Enter kilograms above 0, at most 3 decimals.');
    if (reason.trim().length < 5) return setError('Give the reason (at least 5 characters), e.g. "Continuation run for the last 100 m".');
    setBusy(true);
    try {
      const { data } = await ordersApi.reserveAdditional(order.id, { quantityKg: kg, reason: reason.trim() }, key);
      toast.success(`${formatNumber(kg, 'kg')} more reserved from ${data.reservations.map((r) => r.lotNumber).join(', ')}. The store can issue it to the floor.`, { title: 'Yarn reserved' });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Reserve more yarn for ${order.orderNumber}`}
      subtitle="For a continuation run or to remake rejected rolls. Only free stock is used (never yarn reserved for other orders)."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="topup-form" className="erp-btn-primary" disabled={busy}>{busy ? 'Reserving…' : 'Reserve'}</button>
        </>
      }
    >
      <form id="topup-form" className="erp-form-grid" onSubmit={submit} noValidate>
        <Field label="Quantity (kg)" htmlFor="topup-qty" required>
          <input id="topup-qty" className="erp-input" inputMode="decimal" value={qty} onChange={(e) => { setQty(e.target.value); touch(); }} disabled={busy} />
        </Field>
        <Field label="Reason" htmlFor="topup-reason" required>
          <input id="topup-reason" className="erp-input" maxLength={500} value={reason} onChange={(e) => { setReason(e.target.value); touch(); }} disabled={busy} placeholder="Continuation run for the last 100 m" />
        </Field>
        {error && <p className="login-field-error" role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

export function ReservationPanel({ order, canMove, canTopUp, onChanged }) {
  const data = useApiQuery(() => ordersApi.reservations(order.id), [order.id, order.updatedAt]);
  const [moving, setMoving] = useState(null); // 'issue' | 'return' | 'topup'
  const reservations = data.data?.reservations ?? [];
  const totals = data.data?.totals;
  const inPlay = ['MATERIAL_RESERVED', 'IN_PRODUCTION'].includes(order.status);
  // Reserved yarn can be issued while the order is reserved or already in production (e.g. a top-up).
  const canIssue = canMove && inPlay && totals?.openKg > 0;
  const canReserveMore = canTopUp && inPlay;
  const canReturn = canMove && totals?.onFloorKg > 0;

  if (data.error) return <div className="erp-card section-gap"><ErrorState error={data.error} onRetry={data.reload} /></div>;
  if (!data.data) return <div className="erp-card section-gap"><LoadingState label="Loading reservations…" /></div>;
  if (reservations.length === 0) return null;
  return (
    <div className="erp-card section-gap">
      <div className="card-header">
        <div>
          <h3 className="card-title">Yarn for this order</h3>
          <p className="card-subtitle">Reserved lots and where the yarn is now. Every movement is in each lot's ledger.</p>
        </div>
        <div className="row-actions">
          {canIssue && <button type="button" className="erp-btn-primary" onClick={() => setMoving('issue')}>Issue to production</button>}
          {canReturn && <button type="button" className="erp-btn-outline" onClick={() => setMoving('return')}>Return to store</button>}
          {canReserveMore && <button type="button" className="erp-btn-outline" onClick={() => setMoving('topup')}>Reserve more yarn</button>}
        </div>
      </div>
      <table className="erp-data-table">
        <thead>
          <tr>
            <th scope="col">Lot</th>
            <th scope="col">Status</th>
            <th scope="col" className="num">Reserved</th>
            <th scope="col" className="num">Still reserved</th>
            <th scope="col" className="num">Issued</th>
            <th scope="col" className="num">On the floor</th>
            <th scope="col" className="num">Released</th>
          </tr>
        </thead>
        <tbody>
          {reservations.map((r) => (
            <tr key={r.id}>
              <td className="mono">{r.lotNumber}</td>
              <td><span className={`erp-status-badge ${r.status === 'RELEASED' ? 'neutral' : 'active'}`}>{STATUS_LABELS[r.status] ?? r.status}</span></td>
              <td className="num">{formatNumber(r.reservedKg, 'kg')}</td>
              <td className="num">{formatNumber(r.openKg, 'kg')}</td>
              <td className="num">{formatNumber(r.issuedKg, 'kg')}</td>
              <td className="num">{formatNumber(r.onFloorKg, 'kg')}</td>
              <td className="num">{formatNumber(r.releasedKg, 'kg')}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" colSpan={2}>Total</th>
            <td className="num"><strong>{formatNumber(totals.reservedKg, 'kg')}</strong></td>
            <td className="num"><strong>{formatNumber(totals.openKg, 'kg')}</strong></td>
            <td className="num"><strong>{formatNumber(totals.issuedKg, 'kg')}</strong></td>
            <td className="num"><strong>{formatNumber(totals.onFloorKg, 'kg')}</strong></td>
            <td className="num"><strong>{formatNumber(totals.releasedKg, 'kg')}</strong></td>
          </tr>
        </tfoot>
      </table>
      {moving === 'topup' && (
        <TopUpModal
          order={order}
          onClose={() => setMoving(null)}
          onDone={() => {
            setMoving(null);
            data.reload();
            onChanged?.();
          }}
        />
      )}
      {moving && moving !== 'topup' && (
        <MoveYarnModal
          order={order}
          kind={moving}
          maxKg={moving === 'issue' ? totals.openKg : totals.onFloorKg}
          onClose={() => setMoving(null)}
          onDone={() => {
            setMoving(null);
            data.reload();
            onChanged?.();
          }}
        />
      )}
    </div>
  );
}
