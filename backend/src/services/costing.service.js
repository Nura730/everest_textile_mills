import { recordAudit } from '../audit/recordAudit.js';
import { ORDER_STATUS } from '../constants/orderStatus.js';
import { ROLL_STATUS, RUN_STATUS } from '../constants/production.js';
import { Invoice } from '../models/Fulfilment.js';
import { InventoryTransaction } from '../models/InventoryTransaction.js';
import { Machine } from '../models/Machine.js';
import { MachineEvent } from '../models/MachineEvent.js';
import { Order } from '../models/Order.js';
import { ProductionRun } from '../models/ProductionRun.js';
import { DEFAULT_RATES, RateCard, rateCardAt, toPublicRateCard } from '../models/RateCard.js';
import { Roll } from '../models/Roll.js';
import { YarnLot } from '../models/YarnLot.js';
import { Attendance } from '../models/Attendance.js';
import { todayInIndia } from '../utils/dates.js';
import { AppError } from '../utils/AppError.js';
import { cmToMetres, gramsToKg } from '../utils/units.js';
import { runInTransaction } from '../utils/transaction.js';

/*
 * Phase 14: actual cost and profitability of an order (instruction.md §16). Every figure says where it
 * comes from: material is the actual cost of the yarn lots issued to the order; labour and machine
 * cost are running hours × the rate card; rework is rounds × a rate; overhead a percentage; waste is
 * the share of cost that went into rejected rolls (already inside the figures above, shown, not added).
 * Revenue is what was invoiced (excluding GST), or the order value marked as expected before invoicing.
 */

export const COST_ASSUMPTIONS = Object.freeze([
  'Material = net yarn issued to the order (issued − returned) × the purchase cost of each lot it came from.',
  'Labour = machine running hours × the labour rate (one operator per running machine, decision D6). Wages recorded in the attendance register are reported separately as a factory expense and never added to order cost (no double counting).',
  'Maintenance cost (recorded when maintenance finishes) is a machine expense, reported separately, not allocated to orders.',
  'Machine = running hours × the hourly rate for the machine type (power, maintenance, depreciation).',
  'Running hours come from each run\'s history: time spent RUNNING, excluding pauses.',
  'Rework = number of rework rounds × the rework rate per roll.',
  'Overhead = a percentage of material + labour + machine + rework.',
  'Waste is the share of cost that went into rejected rolls; it is already included above.',
  'Revenue = invoiced amount excluding GST; before invoicing, the order value is shown as expected revenue.',
]);

/** Hours a run spent RUNNING, from its status history (pauses excluded). Pure. */
export function runningHours(run, now = new Date()) {
  let ms = 0;
  let since = null;
  for (const change of run.statusHistory ?? []) {
    if (change.to === RUN_STATUS.RUNNING) since = new Date(change.at);
    else if (since) {
      ms += new Date(change.at) - since;
      since = null;
    }
  }
  if (since && run.status === RUN_STATUS.RUNNING) ms += now - since;
  return ms / 3_600_000;
}

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/** The cost sheet of one order (ADMIN). */
export async function orderCost(orderId, { now = new Date() } = {}) {
  const order = await Order.findById(orderId).lean();
  if (!order) throw new AppError('NOT_FOUND', 'Order not found');

  const [movements, runs, rolls, invoices] = await Promise.all([
    InventoryTransaction.find({ orderId: order._id, type: { $in: ['ISSUE', 'RETURN'] } }).lean(),
    ProductionRun.find({ orderId: order._id }).lean(),
    Roll.find({ orderId: order._id }, { lengthCm: 1, status: 1, reworkCount: 1 }).lean(),
    Invoice.find({ orderId: order._id }, { subtotalPaise: 1 }).lean(),
  ]);
  const firstStart = runs.map((r) => r.startedAt).filter(Boolean).sort((a, b) => a - b)[0];
  const rates = await rateCardAt(firstStart ?? now);

  // Material: net grams per lot × that lot's cost.
  const lots = await YarnLot.find({ _id: { $in: [...new Set(movements.map((m) => String(m.yarnLotId)))] } }, { lotNumber: 1, costPerKgPaise: 1 }).lean();
  const lotById = new Map(lots.map((l) => [String(l._id), l]));
  const netByLot = new Map();
  for (const m of movements) netByLot.set(String(m.yarnLotId), (netByLot.get(String(m.yarnLotId)) ?? 0) - m.deltaTotalGrams);
  const materialLines = [...netByLot.entries()].filter(([, grams]) => grams !== 0).map(([lotId, grams]) => {
    const lot = lotById.get(lotId);
    return { lotNumber: lot?.lotNumber ?? '?', kg: gramsToKg(grams), costPerKgPaise: lot?.costPerKgPaise ?? 0, amountPaise: Math.round((grams * (lot?.costPerKgPaise ?? 0)) / 1000) };
  });
  const materialPaise = materialLines.reduce((s, l) => s + l.amountPaise, 0);

  // Labour and machine: running hours per run.
  const machines = await Machine.find({ _id: { $in: runs.map((r) => r.machineId) } }, { type: 1, code: 1 }).lean();
  const typeOf = new Map(machines.map((m) => [String(m._id), m.type]));
  const runLines = runs.map((run) => {
    const hours = runningHours(run, now);
    const type = typeOf.get(String(run.machineId)) ?? 'WEAVING';
    return {
      runNumber: run.runNumber,
      machineCode: run.machineCode,
      status: run.status,
      hours: Math.round(hours * 100) / 100,
      labourPaise: Math.round(hours * rates.labourPaisePerHour),
      machinePaise: Math.round(hours * rates.machinePaisePerHour[type]),
    };
  });
  const labourPaise = runLines.reduce((s, r) => s + r.labourPaise, 0);
  const machinePaise = runLines.reduce((s, r) => s + r.machinePaise, 0);
  const reworkRounds = rolls.reduce((s, r) => s + r.reworkCount, 0);
  const reworkPaise = reworkRounds * rates.reworkPaisePerRoll;
  const directPaise = materialPaise + labourPaise + machinePaise + reworkPaise;
  const overheadPaise = Math.round((directPaise * rates.overheadBasisPoints) / 10_000);
  const totalCostPaise = directPaise + overheadPaise;

  const producedCm = rolls.reduce((s, r) => s + r.lengthCm, 0);
  const rejectedCm = rolls.filter((r) => r.status === ROLL_STATUS.REJECTED).reduce((s, r) => s + r.lengthCm, 0);
  const wastePaise = producedCm > 0 ? Math.round(((materialPaise + labourPaise + machinePaise) * rejectedCm) / producedCm) : 0;

  const invoicedPaise = invoices.reduce((s, i) => s + i.subtotalPaise, 0);
  const revenueKind = invoices.length > 0 ? 'INVOICED' : 'EXPECTED';
  const revenuePaise = invoices.length > 0 ? invoicedPaise : order.orderValuePaise;
  const profitPaise = revenuePaise - totalCostPaise;

  return {
    order: { id: String(order._id), orderNumber: order.orderNumber, status: order.status, buyerName: order.buyer.name, productName: order.product.name, quantityMetres: cmToMetres(order.quantityCm) },
    revenue: { kind: revenueKind, amountPaise: revenuePaise },
    cost: { materialPaise, labourPaise, machinePaise, reworkPaise, overheadPaise, totalPaise: totalCostPaise },
    profitPaise,
    marginPercent: pct(profitPaise, revenuePaise),
    waste: { rejectedMetres: cmToMetres(rejectedCm), producedMetres: cmToMetres(producedCm), costInRejectedPaise: wastePaise },
    detail: { material: materialLines, runs: runLines, reworkRounds },
    costPerMetrePaise: producedCm > rejectedCm ? Math.round((totalCostPaise * 100) / (producedCm - rejectedCm)) : null,
    rateCard: toPublicRateCard(rates),
    assumptions: COST_ASSUMPTIONS,
    complete: [ORDER_STATUS.DISPATCHED, ORDER_STATUS.INVOICED].includes(order.status),
  };
}

const COSTED_STATUSES = [
  ORDER_STATUS.IN_PRODUCTION,
  ORDER_STATUS.PRODUCTION_COMPLETED,
  ORDER_STATUS.READY_FOR_DISPATCH,
  ORDER_STATUS.DISPATCHED,
  ORDER_STATUS.INVOICED,
];

/** Profitability of every order that has started production, with totals (ADMIN). */
export async function costingSummary() {
  const orders = await Order.find({ status: { $in: COSTED_STATUSES } }, { _id: 1 }).sort({ createdAt: -1 }).limit(200).lean();
  const sheets = await Promise.all(orders.map((o) => orderCost(o._id)));
  const rows = sheets.map((s) => ({
    ...s.order,
    revenueKind: s.revenue.kind,
    revenuePaise: s.revenue.amountPaise,
    costPaise: s.cost.totalPaise,
    profitPaise: s.profitPaise,
    marginPercent: s.marginPercent,
    complete: s.complete,
  }));
  const sum = (key, filter = () => true) => rows.filter(filter).reduce((acc, r) => acc + r[key], 0);
  const invoiced = (r) => r.revenueKind === 'INVOICED';
  return {
    orders: rows,
    totals: {
      invoicedRevenuePaise: sum('revenuePaise', invoiced),
      invoicedCostPaise: sum('costPaise', invoiced),
      invoicedProfitPaise: sum('profitPaise', invoiced),
      invoicedMarginPercent: pct(sum('profitPaise', invoiced), sum('revenuePaise', invoiced)),
      expectedRevenuePaise: sum('revenuePaise', (r) => !invoiced(r)),
      costSoFarPaise: sum('costPaise', (r) => !invoiced(r)),
    },
    rateCard: toPublicRateCard(await rateCardAt()),
    assumptions: COST_ASSUMPTIONS,
    factoryExpenses: { maintenance: await maintenanceExpenses(), wages: await monthWages() },
  };
}

/**
 * Maintenance cost recorded when maintenance finishes, per machine. A machine/factory expense: it is
 * NOT spread over orders (there is no agreed allocation rule) and NOT inside order profit; it is shown
 * next to it. Optional period: from/to as Indian calendar dates.
 */
export async function maintenanceExpenses({ from, to } = {}) {
  const match = { type: 'MAINTENANCE_ENDED', costPaise: { $ne: null } };
  if (from || to) {
    match.occurredAt = {};
    if (from) match.occurredAt.$gte = new Date(`${from}T00:00:00.000+05:30`);
    if (to) match.occurredAt.$lt = new Date(new Date(`${to}T00:00:00.000+05:30`).getTime() + 86_400_000);
  }
  const rows = await MachineEvent.aggregate([{ $match: match }, { $group: { _id: '$machineId', totalPaise: { $sum: '$costPaise' }, jobs: { $sum: 1 } } }]);
  const machines = await Machine.find({ _id: { $in: rows.map((r) => r._id) } }, { code: 1, name: 1 }).lean();
  const byId = new Map(machines.map((m) => [String(m._id), m]));
  const byMachine = rows
    .map((r) => ({ machineId: String(r._id), code: byId.get(String(r._id))?.code ?? '?', name: byId.get(String(r._id))?.name ?? null, totalPaise: r.totalPaise, jobs: r.jobs }))
    .sort((a, b) => b.totalPaise - a.totalPaise);
  return { totalPaise: byMachine.reduce((s, m) => s + m.totalPaise, 0), jobs: byMachine.reduce((s, m) => s + m.jobs, 0), byMachine, allocation: 'Not allocated to orders: machine/factory expense' };
}

/**
 * Wages recorded in the attendance register this calendar month (India). A factory expense shown next to
 * order profit; NOT allocated to orders (order labour stays the machine-hour estimate above, so the two
 * are never added together).
 */
export async function monthWages(today = todayInIndia()) {
  const from = `${today.slice(0, 7)}-01`;
  const [row] = await Attendance.aggregate([{ $match: { date: { $gte: from, $lte: today } } }, { $group: { _id: null, totalPaise: { $sum: '$wagePaise' }, entries: { $sum: 1 } } }]);
  return { totalPaise: row?.totalPaise ?? 0, entries: row?.entries ?? 0, from, to: today, periodLabel: `${from} to ${today}`, allocation: 'Not allocated to orders: factory labour expense' };
}

export async function getRates() {
  const [current, history] = await Promise.all([rateCardAt(), RateCard.find().sort({ version: -1 }).limit(20).lean()]);
  return { current: toPublicRateCard(current), history: history.map(toPublicRateCard), defaults: toPublicRateCard(DEFAULT_RATES) };
}

/** A new rate-card version (ADMIN). Old versions are never edited; costs keep the version they used. */
export function saveRates(input, context) {
  return runInTransaction(async (session) => {
    const latest = await RateCard.findOne().sort({ version: -1 }).session(session).lean();
    const [card] = await RateCard.create([{ ...input, version: (latest?.version ?? 0) + 1, createdBy: context.actor.id }], { session });
    await recordAudit({ action: 'RATE_CARD_SAVED', entityType: 'RateCard', entityId: card._id, after: { version: card.version, ...input } }, context, session);
    return toPublicRateCard(card.toObject());
  });
}
