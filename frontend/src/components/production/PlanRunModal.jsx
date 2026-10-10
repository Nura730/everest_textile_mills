import { useMemo, useState } from 'react';
import { fieldErrorsOf, newIdempotencyKey } from '../../api/client.js';
import { machinesApi, ordersApi, productionApi, productsApi } from '../../api/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { formatNumber } from '../../utils/format.js';
import { MACHINE_TYPE_LABELS } from '../../utils/machineStatus.js';
import { Field, Modal } from '../ui/Modal.jsx';
import { ErrorState, LoadingState } from '../ui/States.jsx';
import { useToast } from '../ui/Toast.jsx';

const OPEN_RUNS = ['PLANNED', 'RUNNING', 'PAUSED'];
const PLANNABLE = ['MATERIAL_RESERVED', 'IN_PRODUCTION'];

/** What of an order is not yet planned: open runs count their target, completed runs their output. */
function remainingMetres(order, runs) {
  const planned = runs.reduce((sum, run) => {
    if (OPEN_RUNS.includes(run.status)) return sum + run.targetMetres;
    if (run.status === 'COMPLETED') return sum + run.producedMetres;
    return sum;
  }, 0);
  return Math.max(0, Math.round((order.quantityMetres - planned) * 100) / 100);
}

/**
 * Plan a production run: an order whose yarn is reserved, on an available machine of the fabric's
 * type, for part or all of what is left. The server re-checks everything (type, availability,
 * quantity) inside the transaction.
 */
export function PlanRunModal({ order: fixedOrder, onClose, onDone }) {
  const toast = useToast();
  const orders = useApiQuery(
    () =>
      fixedOrder
        ? Promise.resolve({ data: { orders: [fixedOrder] } })
        : Promise.all(PLANNABLE.map((status) => ordersApi.list({ status, limit: 100 }))).then((pages) => ({ data: { orders: pages.flatMap((p) => p.data.orders) } })),
    [fixedOrder?.id],
  );
  const machines = useApiQuery(() => machinesApi.list({ status: 'AVAILABLE', limit: 100 }), []);
  const [orderId, setOrderId] = useState(fixedOrder?.id ?? '');
  const order = (orders.data?.orders ?? []).find((o) => o.id === orderId) ?? null;
  const runs = useApiQuery(() => (orderId ? productionApi.list({ orderId, limit: 100 }) : Promise.resolve({ data: { runs: [] } })), [orderId]);
  // The fabric's machine type narrows the machine list (the server enforces it either way).
  const product = useApiQuery(() => (order ? productsApi.get(order.product.id).catch(() => ({ data: { product: null } })) : Promise.resolve({ data: { product: null } })), [order?.product.id]);
  const neededType = product.data?.product?.machineType ?? null;
  const machineOptions = useMemo(
    () => (machines.data?.machines ?? []).filter((m) => !neededType || m.type === neededType),
    [machines.data, neededType],
  );
  const remaining = order && runs.data ? remainingMetres(order, runs.data.runs) : null;
  const [machineId, setMachineId] = useState('');
  const [target, setTarget] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const touch = () => {
    setErrors({});
    setKey(newIdempotencyKey());
  };
  const targetValue = target === '' && remaining !== null ? String(remaining) : target;

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const metres = Number(targetValue);
    const found = {};
    if (!orderId) found.orderId = 'Choose an order whose yarn is reserved.';
    if (!machineId) found.machineId = 'Choose an available machine.';
    if (!(metres > 0) || !/^\d+(\.\d{1,2})?$/.test(targetValue.trim())) found.targetMetres = 'Metres above 0, at most 2 decimals.';
    else if (remaining !== null && metres > remaining) found.targetMetres = `Only ${formatNumber(remaining, 'm')} of this order is left to plan.`;
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const { data } = await productionApi.plan({ orderId, machineId, targetMetres: metres }, key);
      toast.success(`Run ${data.run.runNumber} planned on ${data.run.machineCode}.`);
      onDone(data.run);
    } catch (error) {
      const fields = fieldErrorsOf(error);
      if (Object.keys(fields).length) setErrors(fields);
      else {
        toast.error(error, { title: 'Run not planned' });
        machines.reload();
        runs.reload();
        setKey(newIdempotencyKey());
      }
    } finally {
      setBusy(false);
    }
  }

  const loading = orders.loading || machines.loading;
  const loadError = orders.error || machines.error;
  return (
    <Modal
      title="Plan a production run"
      subtitle="Books an available machine for an order whose yarn is reserved."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="erp-btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="plan-run-form" className="erp-btn-primary" disabled={busy || loading || Boolean(loadError)}>{busy ? 'Planning…' : 'Plan run'}</button>
        </>
      }
    >
      {loading && <LoadingState />}
      {loadError && <ErrorState error={loadError} onRetry={() => { orders.reload(); machines.reload(); }} />}
      {!loading && !loadError && (
        <form id="plan-run-form" className="erp-form-grid" onSubmit={onSubmit} noValidate>
          <Field label="Order" htmlFor="pr-order" error={errors.orderId} required hint={orders.data.orders.length ? undefined : 'No order has reserved yarn yet. Reserve yarn on a confirmed order first.'}>
            <select id="pr-order" className="erp-input" value={orderId} onChange={(event) => { setOrderId(event.target.value); setTarget(''); setMachineId(''); touch(); }} disabled={busy || Boolean(fixedOrder)}>
              <option value="">Select an order…</option>
              {orders.data.orders.map((o) => (
                <option key={o.id} value={o.id}>{o.orderNumber} — {formatNumber(o.quantityMetres, 'm')} {o.product.name} (due {o.requiredBy})</option>
              ))}
            </select>
          </Field>
          <Field
            label="Machine"
            htmlFor="pr-machine"
            error={errors.machineId}
            required
            hint={neededType ? `Available ${MACHINE_TYPE_LABELS[neededType].toLowerCase()} machines only.` : 'Available machines.'}
          >
            <select id="pr-machine" className="erp-input" value={machineId} onChange={(event) => { setMachineId(event.target.value); touch(); }} disabled={busy}>
              <option value="">{machineOptions.length ? 'Select a machine…' : 'No suitable machine is available'}</option>
              {machineOptions.map((m) => (
                <option key={m.id} value={m.id}>{m.code} — {m.name} ({formatNumber(m.ratedMetresPerHour, 'm/h')})</option>
              ))}
            </select>
          </Field>
          <Field
            label="Target (metres)"
            htmlFor="pr-target"
            error={errors.targetMetres}
            required
            hint={remaining !== null ? `${formatNumber(remaining, 'm')} of ${formatNumber(order.quantityMetres, 'm')} left to plan.` : undefined}
          >
            <input id="pr-target" className="erp-input" inputMode="decimal" value={targetValue} onChange={(event) => { setTarget(event.target.value); touch(); }} disabled={busy || !orderId} />
          </Field>
        </form>
      )}
    </Modal>
  );
}
