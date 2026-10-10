import { MACHINE_STATUS } from '../constants/machines.js';
import { ORDER_STATUS } from '../constants/orderStatus.js';
import { ROLL_STATUS, RUN_STATUS } from '../constants/production.js';
import { ROLES } from '../constants/roles.js';
import { DISPATCH_STATUS, Dispatch } from '../models/Fulfilment.js';
import { Machine } from '../models/Machine.js';
import { Order } from '../models/Order.js';
import { ProductionRun } from '../models/ProductionRun.js';
import { Roll } from '../models/Roll.js';
import { gramsToKg } from '../utils/units.js';
import { assessOrderFeasibility } from './feasibility.service.js';
import { insightsOverview } from './intelligence.service.js';

/*
 * What needs the signed-in user's attention right now (navigation badges and the dashboard's
 * "Operational insights"). Every item comes from recorded data and the existing deterministic rules
 * (feasibility, delivery risk); nothing is predicted beyond them. Each role sees only what it can act
 * on, and a buyer only their own company's orders, in plain words.
 *
 * alert: { key, priority: HIGH|MEDIUM|LOW, title, why, affected: [{ label, to }], action, to }
 */

const kg = (grams) => `${gramsToKg(grams).toLocaleString('en-IN')} kg`;
const PRIORITY_ORDER = { HIGH: 0, MEDIUM: 1, LOW: 2 };
const SEES = {
  confirmations: [ROLES.ADMIN],
  material: [ROLES.ADMIN, ROLES.FLOOR_MANAGER, ROLES.STORE_KEEPER],
  qc: [ROLES.ADMIN, ROLES.QC_INSPECTOR, ROLES.FLOOR_MANAGER],
  machines: [ROLES.ADMIN, ROLES.FLOOR_MANAGER],
  dispatch: [ROLES.ADMIN, ROLES.STORE_KEEPER],
  risk: [ROLES.ADMIN, ROLES.FLOOR_MANAGER, ROLES.STORE_KEEPER],
};
const sees = (role, what) => SEES[what].includes(role);

/** Shortfalls of confirmed (not yet reserved) orders: they block production until yarn is there. */
async function materialShortages() {
  const confirmed = await Order.find({ status: ORDER_STATUS.CONFIRMED }).sort({ requiredBy: 1 }).limit(100).lean();
  const out = [];
  for (const order of confirmed) {
    const { inputs } = await assessOrderFeasibility(order);
    out.push({ order, shortfallGrams: inputs.shortfallGrams, freeGrams: inputs.freeGrams });
  }
  return out;
}

export async function attentionFor(actor) {
  const role = actor.role;
  const alerts = [];
  const badges = {};

  if (role === ROLES.BUYER) {
    // Plain outlook of the company's own open orders (no internal factors).
    const own = await Order.find({ buyerId: actor.buyerId, status: { $nin: [ORDER_STATUS.CANCELLED, ORDER_STATUS.REJECTED, ORDER_STATUS.INVOICED] } }, { _id: 1 }).lean();
    const { orders } = own.length ? await insightsOverview() : { orders: [] };
    const mine = new Set(own.map((o) => String(o._id)));
    for (const { order, risk } of orders.filter((o) => mine.has(o.order.id) && o.risk.level !== 'ON_TRACK')) {
      alerts.push({
        key: `buyer-risk-${order.id}`,
        priority: risk.level === 'LATE' ? 'HIGH' : 'MEDIUM',
        title: `${order.orderNumber} ${risk.level === 'LATE' ? 'is expected after its required date' : 'has a tight schedule'}`,
        why: `Required by ${order.requiredBy}. The factory is following it up.`,
        affected: [{ label: order.orderNumber, to: `/orders/${order.id}` }],
        action: 'Open the order for its timeline.',
        to: `/orders/${order.id}`,
      });
    }
    badges['/orders'] = alerts.length;
    return { alerts, badges, generatedAt: new Date() };
  }

  if (sees(role, 'confirmations')) {
    const waiting = await Order.find({ status: ORDER_STATUS.ORDER_CREATED }, { orderNumber: 1, requiredBy: 1 }).sort({ createdAt: 1 }).lean();
    badges['/orders'] = waiting.length;
    if (waiting.length) {
      alerts.push({
        key: 'orders-to-confirm',
        priority: 'MEDIUM',
        title: `${waiting.length} order(s) waiting for confirmation`,
        why: 'Production cannot be planned until an order is confirmed against stock.',
        affected: waiting.slice(0, 5).map((o) => ({ label: o.orderNumber, to: `/orders/${o._id}` })),
        action: 'Check feasibility, then confirm or reject.',
        to: '/orders?status=ORDER_CREATED',
      });
    }
  }

  if (sees(role, 'material')) {
    const shortages = await materialShortages();
    const blocked = shortages.filter((s) => s.shortfallGrams > 0);
    const ready = shortages.filter((s) => s.shortfallGrams === 0);
    if (role === ROLES.FLOOR_MANAGER) badges['/orders'] = ready.length;
    if (blocked.length) {
      const byYarn = new Map();
      for (const s of blocked) {
        const k = `${s.order.product.material} ${s.order.product.colour}`;
        byYarn.set(k, (byYarn.get(k) ?? 0) + s.shortfallGrams);
      }
      if (role === ROLES.STORE_KEEPER) badges['/inventory'] = byYarn.size;
      alerts.push({
        key: 'material-shortage',
        priority: 'HIGH',
        title: `${blocked.length} confirmed order(s) blocked by a yarn shortage`,
        why: [...byYarn.entries()].map(([yarn, grams]) => `${yarn.toLowerCase()}: short by ${kg(grams)}`).join('; '),
        affected: blocked.slice(0, 5).map((s) => ({ label: s.order.orderNumber, to: `/orders/${s.order._id}` })),
        action: role === ROLES.STORE_KEEPER ? 'Receive the missing yarn.' : 'Reserve once the store has received the missing yarn.',
        to: role === ROLES.STORE_KEEPER ? '/inventory' : '/orders?status=CONFIRMED',
      });
    }
    if (ready.length && role !== ROLES.STORE_KEEPER) {
      alerts.push({
        key: 'ready-to-reserve',
        priority: 'MEDIUM',
        title: `${ready.length} confirmed order(s) have enough yarn to reserve`,
        why: 'Reserving protects the yarn for these orders so production can start.',
        affected: ready.slice(0, 5).map((s) => ({ label: s.order.orderNumber, to: `/orders/${s.order._id}` })),
        action: role === ROLES.FLOOR_MANAGER || role === ROLES.ADMIN ? 'Reserve the yarn.' : null,
        to: '/orders?status=CONFIRMED',
      });
    }
  }

  if (sees(role, 'qc')) {
    const [pending, rework] = await Promise.all([
      Roll.find({ status: ROLL_STATUS.QC_PENDING }, { rollNumber: 1 }).sort({ createdAt: 1 }).limit(50).lean(),
      Roll.find({ status: ROLL_STATUS.IN_REWORK }, { rollNumber: 1, reworkCount: 1 }).sort({ createdAt: 1 }).limit(50).lean(),
    ]);
    badges['/quality'] = role === ROLES.FLOOR_MANAGER ? rework.length : pending.length;
    if (pending.length && role !== ROLES.FLOOR_MANAGER) {
      alerts.push({
        key: 'qc-pending',
        priority: 'MEDIUM',
        title: `${pending.length} roll(s) waiting for inspection`,
        why: 'Rolls cannot become finished goods or be dispatched until QC passes them.',
        affected: pending.slice(0, 5).map((r) => ({ label: r.rollNumber, to: `/rolls/${r._id}` })),
        action: role === ROLES.QC_INSPECTOR || role === ROLES.ADMIN ? 'Inspect and sign the decision.' : null,
        to: '/quality',
      });
    }
    if (rework.length) {
      const repeated = rework.filter((r) => r.reworkCount >= 1).length;
      alerts.push({
        key: 'qc-rework',
        priority: repeated ? 'HIGH' : 'MEDIUM',
        title: `${rework.length} roll(s) on quality hold for rework`,
        why: repeated ? `${repeated} of them already went through rework before.` : 'They return to inspection once the rework is done.',
        affected: rework.slice(0, 5).map((r) => ({ label: r.rollNumber, to: `/rolls/${r._id}` })),
        action: role === ROLES.FLOOR_MANAGER || role === ROLES.ADMIN ? 'Finish the rework and send the roll back to QC.' : null,
        to: '/quality',
      });
    }
  }

  if (sees(role, 'machines')) {
    const [stopped, paused] = await Promise.all([
      Machine.find({ isActive: true, status: { $in: [MACHINE_STATUS.DOWN, MACHINE_STATUS.MAINTENANCE] } }, { code: 1, status: 1 }).lean(),
      ProductionRun.find({ status: RUN_STATUS.PAUSED }, { runNumber: 1, machineCode: 1 }).lean(),
    ]);
    badges['/machines'] = stopped.length;
    badges['/production'] = paused.length;
    if (stopped.length) {
      const down = stopped.filter((m) => m.status === MACHINE_STATUS.DOWN);
      alerts.push({
        key: 'machines-stopped',
        priority: down.length ? 'HIGH' : 'LOW',
        title: `${stopped.length} machine(s) not available (${down.length} down, ${stopped.length - down.length} in maintenance)`,
        why: 'Recorded machine status: runs on these machines cannot produce.',
        affected: stopped.map((m) => ({ label: `${m.code} · ${m.status === MACHINE_STATUS.DOWN ? 'down' : 'maintenance'}`, to: `/machines/${m._id}` })),
        action: 'Resolve the problem or finish the maintenance.',
        to: '/machines',
      });
    }
    if (paused.length) {
      alerts.push({
        key: 'runs-paused',
        priority: 'MEDIUM',
        title: `${paused.length} production run(s) paused`,
        why: 'A paused run produces nothing until it is resumed.',
        affected: paused.map((r) => ({ label: `${r.runNumber} on ${r.machineCode}`, to: `/production/${r._id}` })),
        action: 'Resume when the cause is cleared.',
        to: '/production?status=PAUSED',
      });
    }
  }

  if (sees(role, 'dispatch')) {
    const [ready, prepared] = await Promise.all([
      Order.find({ status: ORDER_STATUS.READY_FOR_DISPATCH }, { orderNumber: 1 }).lean(),
      Dispatch.find({ status: DISPATCH_STATUS.PREPARED }, { dispatchNumber: 1 }).lean(),
    ]);
    badges['/dispatch'] = ready.length + prepared.length;
    if (prepared.length) {
      alerts.push({
        key: 'dispatch-awaiting-signature',
        priority: 'HIGH',
        title: `${prepared.length} dispatch(es) awaiting signed confirmation`,
        why: 'Goods are packed and reserved but have not been handed over.',
        affected: prepared.map((d) => ({ label: d.dispatchNumber, to: '/dispatch' })),
        action: role === ROLES.STORE_KEEPER || role === ROLES.ADMIN ? 'Confirm and sign the handoff.' : null,
        to: '/dispatch',
      });
    }
    if (ready.length) {
      alerts.push({
        key: 'ready-for-dispatch',
        priority: 'MEDIUM',
        title: `${ready.length} order(s) ready for dispatch`,
        why: 'All their rolls passed QC and are in finished goods.',
        affected: ready.map((o) => ({ label: o.orderNumber, to: `/orders/${o._id}` })),
        action: role === ROLES.STORE_KEEPER || role === ROLES.ADMIN ? 'Prepare the dispatch.' : null,
        to: '/dispatch',
      });
    }
  }

  if (sees(role, 'risk')) {
    const { orders } = await insightsOverview();
    const atRisk = orders.filter((o) => o.risk.level !== 'ON_TRACK');
    for (const { order, risk } of atRisk.slice(0, 5)) {
      alerts.push({
        key: `risk-${order.id}`,
        priority: risk.level === 'LATE' ? 'HIGH' : 'MEDIUM',
        title: `${order.orderNumber} ${risk.level === 'LATE' ? 'is likely to miss' : 'is at risk of missing'} ${order.requiredBy}`,
        why: risk.factors.find((f) => f.severity !== 'INFO')?.message ?? risk.factors[0]?.message ?? 'See the order for details.',
        affected: [{ label: order.orderNumber, to: `/orders/${order.id}` }],
        action: risk.recommendations[0]?.message ?? null,
        to: '/insights',
      });
    }
    badges['/insights'] = atRisk.length;
  }

  alerts.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
  return { alerts, badges, generatedAt: new Date() };
}
