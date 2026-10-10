import { ORDER_STATUS } from '../constants/orderStatus.js';
import { ROLL_STATUS, RUN_STATUS } from '../constants/production.js';
import { CANNOT_RUN_STATUSES, MACHINE_STATUS } from '../constants/machines.js';
import { FG_STATUS, FinishedGood } from '../models/Fulfilment.js';
import { Machine } from '../models/Machine.js';
import { MachineEvent } from '../models/MachineEvent.js';
import { Order } from '../models/Order.js';
import { Product } from '../models/Product.js';
import { ProductionRun } from '../models/ProductionRun.js';
import { rateCardAt } from '../models/RateCard.js';
import { Roll } from '../models/Roll.js';
import { AppError } from '../utils/AppError.js';
import { addDaysToDateString, dateToDateString, todayInIndia } from '../utils/dates.js';
import { cmToMetres, gramsToKg } from '../utils/units.js';
import { assessOrderFeasibility, daysBetween } from './feasibility.service.js';
import { onTimeline } from './portal.service.js';

/*
 * Phase 17: rules-based intelligence (instruction.md §17). No black box: every risk level comes from
 * named factors with the numbers behind them, and every recommendation says what to do and why.
 *
 * Delivery estimate = days of production left + 1 day for QC and dispatch, where
 *   days of production = remaining metres ÷ (rated speed of the machines working on the order)
 *                        ÷ working hours per day (rate card; default 16).
 * Remaining metres = ordered − produced + rejected (rejected rolls must be made again).
 * Level: LATE when the estimate is after the required date; AT_RISK when it leaves 1 day or less of
 * slack, or a blocking factor exists (machine down, no yarn, no machine); otherwise ON_TRACK.
 */

export const RISK_LEVEL = Object.freeze({ ON_TRACK: 'ON_TRACK', AT_RISK: 'AT_RISK', LATE: 'LATE' });
const QC_DISPATCH_BUFFER_DAYS = 1;
const OPEN_STATUSES = [
  ORDER_STATUS.CONFIRMED,
  ORDER_STATUS.MATERIAL_RESERVED,
  ORDER_STATUS.IN_PRODUCTION,
  ORDER_STATUS.PRODUCTION_COMPLETED,
  ORDER_STATUS.READY_FOR_DISPATCH,
];
const m = (cm) => `${cmToMetres(cm).toLocaleString('en-IN')} m`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Production days for `cm` at `cmPerHour`, rounded up to whole days. */
const productionDays = (cm, cmPerHour, hoursPerDay) => (cm <= 0 ? 0 : Math.ceil(cm / cmPerHour / hoursPerDay));

/**
 * The risk verdict from plain numbers (pure: no database, no clock).
 * runs: [{ runNumber, status, machineCode, machineStatus, ratedCmPerHour }] (open runs only)
 * freeMachines: [{ code, ratedCmPerHour }] AVAILABLE machines of the fabric's type, fastest first
 */
export function assessDeliveryRisk({
  status,
  quantityCm,
  producedCm,
  rejectedCm,
  runs,
  freeMachines,
  machineType,
  hoursPerDay,
  today,
  requiredBy,
  materialShortfallGrams = 0,
  yarnLabel = 'yarn',
  rollsAwaitingQc = 0,
  rollsTotal = 0,
  rollsRejected = 0,
  readyCm = 0,
}) {
  const factors = [];
  const recommendations = [];
  const factor = (code, severity, message) => factors.push({ code, severity, message });
  const recommend = (code, message) => recommendations.push({ code, message });

  const remainingCm = Math.max(0, quantityCm - producedCm + rejectedCm);
  const daysLeft = daysBetween(today, requiredBy);
  const working = runs.filter((r) => !CANNOT_RUN_STATUSES.includes(r.machineStatus));
  const stopped = runs.filter((r) => CANNOT_RUN_STATUSES.includes(r.machineStatus));
  let capacity = working.reduce((sum, r) => sum + r.ratedCmPerHour, 0);
  let assumedMachine = null;

  if (remainingCm > 0 && capacity === 0) {
    if (freeMachines.length) {
      assumedMachine = freeMachines[0];
      capacity = assumedMachine.ratedCmPerHour;
    } else {
      factor('NO_MACHINE', 'HIGH', `No ${machineType.toLowerCase()} machine is working on this order or free to take it.`);
    }
  }

  const prodDays = capacity > 0 ? productionDays(remainingCm, capacity, hoursPerDay) : null;
  const buffer = [ORDER_STATUS.READY_FOR_DISPATCH].includes(status) ? 0 : QC_DISPATCH_BUFFER_DAYS;
  const daysNeeded = prodDays === null ? null : prodDays + buffer;
  const expectedFinish = daysNeeded === null ? null : addDaysToDateString(today, daysNeeded);

  // Factors
  if (remainingCm > 0 && prodDays !== null) {
    const how = assumedMachine
      ? `if planned on ${assumedMachine.code} (${m(assumedMachine.ratedCmPerHour)}/h)`
      : `on ${working.map((r) => r.machineCode).join(' + ')} (${m(capacity)}/h together)`;
    factor('PRODUCTION_TIME', 'INFO', `${m(remainingCm)} still to produce: about ${plural(prodDays, 'day')} ${how} at ${hoursPerDay} working hours a day.`);
  }
  if (rejectedCm > 0) factor('REMAKE', 'MEDIUM', `${m(rejectedCm)} was rejected in QC and must be produced again.`);
  for (const run of stopped) {
    factor('MACHINE_STOPPED', 'HIGH', `${run.machineCode} is ${run.machineStatus.toLowerCase()}, so ${run.runNumber} cannot produce.`);
  }
  if (status === ORDER_STATUS.CONFIRMED && materialShortfallGrams > 0) {
    factor('MATERIAL_SHORT', 'HIGH', `Short by ${gramsToKg(materialShortfallGrams).toLocaleString('en-IN')} kg of ${yarnLabel}; production cannot start.`);
  }
  if (rollsTotal >= 3 && rollsRejected / rollsTotal > 0.1) {
    factor('QUALITY', 'MEDIUM', `${rollsRejected} of ${rollsTotal} rolls were rejected (${Math.round((rollsRejected / rollsTotal) * 100)}%).`);
  }
  if (daysLeft < 0) factor('OVERDUE', 'HIGH', `The required date passed ${plural(-daysLeft, 'day')} ago.`);

  // Level
  const blocking = factors.some((f) => f.severity === 'HIGH');
  let level = RISK_LEVEL.ON_TRACK;
  if (daysLeft < 0 || (daysNeeded !== null && daysNeeded > daysLeft)) level = RISK_LEVEL.LATE;
  else if (blocking || daysNeeded === null || daysLeft - daysNeeded <= 1) level = RISK_LEVEL.AT_RISK;
  const slackDays = daysNeeded === null ? null : daysLeft - daysNeeded;
  const score = Math.min(100, (level === RISK_LEVEL.LATE ? 80 : level === RISK_LEVEL.AT_RISK ? 50 : 10)
    + factors.filter((f) => f.severity === 'HIGH').length * 10
    + (slackDays !== null && slackDays < 0 ? Math.min(10, -slackDays * 2) : 0));

  // Recommendations (most useful first)
  for (const run of stopped) recommend('FIX_MACHINE', `Resolve the problem on ${run.machineCode} or move ${run.runNumber} to another machine.`);
  for (const run of runs.filter((r) => r.status === RUN_STATUS.PAUSED && !CANNOT_RUN_STATUSES.includes(r.machineStatus))) {
    recommend('RESUME_RUN', `Resume ${run.runNumber} on ${run.machineCode}; it is paused.`);
  }
  if (status === ORDER_STATUS.CONFIRMED) {
    recommend(materialShortfallGrams > 0 ? 'BUY_YARN' : 'RESERVE_YARN', materialShortfallGrams > 0
      ? `Receive at least ${gramsToKg(materialShortfallGrams).toLocaleString('en-IN')} kg of ${yarnLabel}, then reserve it for this order.`
      : `Reserve the ${yarnLabel} now so production can start.`);
  }
  if (status === ORDER_STATUS.MATERIAL_RESERVED && runs.length === 0 && assumedMachine) {
    recommend('PLAN_RUN', `Plan a run on ${assumedMachine.code}; it is free and finishes the order in about ${plural(prodDays, 'day')}.`);
  }
  const spare = freeMachines.filter((f) => f.code !== assumedMachine?.code);
  if (level !== RISK_LEVEL.ON_TRACK && remainingCm > 0 && spare.length && capacity > 0) {
    const extra = spare[0];
    const faster = productionDays(remainingCm, capacity + extra.ratedCmPerHour, hoursPerDay) + buffer;
    if (faster < daysNeeded) {
      recommend('ADD_MACHINE', `Split the remaining ${m(remainingCm)} with ${extra.code} (free, ${m(extra.ratedCmPerHour)}/h): about ${plural(faster, 'day')} instead of ${daysNeeded}.`);
    }
  }
  if (factors.some((f) => f.code === 'QUALITY')) recommend('CHECK_QUALITY', 'Check machine settings and yarn quality before producing more; rejected metres add to the remaining work.');
  if (rollsAwaitingQc > 0) recommend('INSPECT', `Inspect ${plural(rollsAwaitingQc, 'roll')} waiting for QC so passed metres can be dispatched.`);
  if (status === ORDER_STATUS.READY_FOR_DISPATCH && readyCm > 0) recommend('DISPATCH', `Prepare dispatch: ${m(readyCm)} is in finished goods.`);
  if (level === RISK_LEVEL.LATE) recommend('TALK_TO_BUYER', 'Agree a revised delivery date with the buyer now rather than at the deadline.');

  return { level, score, daysLeft, daysNeeded, slackDays, expectedFinish, remainingMetres: cmToMetres(remainingCm), factors, recommendations };
}

async function gather(order, { today, hoursPerDay }) {
  const [product, runs, rolls, ready] = await Promise.all([
    Product.findById(order.productId, { machineType: 1 }).lean(),
    ProductionRun.find({ orderId: order._id, status: { $ne: RUN_STATUS.CANCELLED } }).lean(),
    Roll.find({ orderId: order._id }, { status: 1, lengthCm: 1 }).lean(),
    FinishedGood.aggregate([{ $match: { orderId: order._id, status: { $ne: FG_STATUS.DISPATCHED } } }, { $group: { _id: null, cm: { $sum: '$lengthCm' } } }]),
  ]);
  const machineType = product?.machineType ?? 'WEAVING';
  const openRuns = runs.filter((r) => [RUN_STATUS.PLANNED, RUN_STATUS.RUNNING, RUN_STATUS.PAUSED].includes(r.status));
  const [runMachines, freeMachines] = await Promise.all([
    Machine.find({ _id: { $in: openRuns.map((r) => r.machineId) } }, { code: 1, status: 1, ratedCmPerHour: 1 }).lean(),
    Machine.find({ type: machineType, isActive: true, status: MACHINE_STATUS.AVAILABLE }, { code: 1, ratedCmPerHour: 1 }).sort({ ratedCmPerHour: -1, code: 1 }).lean(),
  ]);
  const byId = new Map(runMachines.map((mc) => [String(mc._id), mc]));
  let materialShortfallGrams = 0;
  if (order.status === ORDER_STATUS.CONFIRMED) materialShortfallGrams = (await assessOrderFeasibility(order)).inputs.shortfallGrams;
  const rejected = rolls.filter((r) => r.status === ROLL_STATUS.REJECTED);

  return assessDeliveryRisk({
    status: order.status,
    quantityCm: order.quantityCm,
    producedCm: runs.reduce((s, r) => s + r.producedCm, 0),
    rejectedCm: rejected.reduce((s, r) => s + r.lengthCm, 0),
    runs: openRuns.map((r) => {
      const mc = byId.get(String(r.machineId));
      return { runNumber: r.runNumber, status: r.status, machineCode: r.machineCode, machineStatus: mc?.status ?? MACHINE_STATUS.DOWN, ratedCmPerHour: mc?.ratedCmPerHour ?? 0 };
    }),
    freeMachines: freeMachines.map((f) => ({ code: f.code, ratedCmPerHour: f.ratedCmPerHour })),
    machineType,
    hoursPerDay,
    today,
    requiredBy: dateToDateString(order.requiredBy),
    materialShortfallGrams,
    yarnLabel: `${order.product.material.toLowerCase()} ${order.product.colour} yarn`,
    rollsAwaitingQc: rolls.filter((r) => [ROLL_STATUS.QC_PENDING, ROLL_STATUS.IN_REWORK].includes(r.status)).length,
    rollsTotal: rolls.length,
    rollsRejected: rejected.length,
    readyCm: ready[0]?.cm ?? 0,
  });
}

const orderSummary = (order) => ({
  id: String(order._id),
  orderNumber: order.orderNumber,
  status: order.status,
  buyerName: order.buyer.name,
  productName: order.product.name,
  quantityMetres: cmToMetres(order.quantityCm),
  requiredBy: dateToDateString(order.requiredBy),
});

/** Risk and recommendations for one order (staff). */
export async function orderInsight(orderId) {
  const order = await Order.findById(orderId).lean();
  if (!order) throw new AppError('NOT_FOUND', 'Order not found');
  if (!OPEN_STATUSES.includes(order.status)) return { order: orderSummary(order), risk: null };
  const { workingHoursPerDay } = await rateCardAt();
  return { order: orderSummary(order), risk: await gather(order, { today: todayInIndia(), hoursPerDay: workingHoursPerDay }) };
}

/** Machines with repeated problems in the last 30 days: candidates for preventive maintenance. */
async function machineInsights(now = new Date()) {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const rows = await MachineEvent.aggregate([
    { $match: { type: 'PROBLEM_REPORTED', occurredAt: { $gte: since } } },
    { $group: { _id: '$machineId', problems: { $sum: 1 }, critical: { $sum: { $cond: [{ $eq: ['$problem.severity', 'CRITICAL'] }, 1, 0] } }, downtime: { $sum: { $ifNull: ['$problem.estimatedDowntimeMinutes', 0] } } } },
    { $match: { problems: { $gte: 3 } } },
    { $sort: { problems: -1 } },
  ]);
  const machines = await Machine.find({ _id: { $in: rows.map((r) => r._id) } }, { code: 1, name: 1, status: 1 }).lean();
  const byId = new Map(machines.map((mc) => [String(mc._id), mc]));
  return rows.filter((r) => byId.has(String(r._id))).map((r) => {
    const mc = byId.get(String(r._id));
    return {
      machineId: String(r._id),
      code: mc.code,
      status: mc.status,
      problems: r.problems,
      critical: r.critical,
      estimatedDowntimeMinutes: r.downtime,
      recommendation: `${mc.code} had ${r.problems} problems in 30 days (${r.critical} critical). Schedule preventive maintenance before it stops an order.`,
    };
  });
}

/** Every open order ranked by risk, plus machine maintenance candidates (staff dashboard). */
export async function insightsOverview() {
  const orders = await Order.find({ status: { $in: OPEN_STATUSES } }).sort({ requiredBy: 1 }).limit(200).lean();
  const { workingHoursPerDay } = await rateCardAt();
  const today = todayInIndia();
  const assessed = [];
  for (const order of orders) assessed.push({ order: orderSummary(order), risk: await gather(order, { today, hoursPerDay: workingHoursPerDay }) });
  assessed.sort((a, b) => b.risk.score - a.risk.score || a.order.requiredBy.localeCompare(b.order.requiredBy));
  const count = (level) => assessed.filter((a) => a.risk.level === level).length;
  return {
    orders: assessed,
    counts: { LATE: count(RISK_LEVEL.LATE), AT_RISK: count(RISK_LEVEL.AT_RISK), ON_TRACK: count(RISK_LEVEL.ON_TRACK) },
    machines: await machineInsights(),
    assumptions: [
      `Production time uses each machine's rated speed and ${workingHoursPerDay} working hours a day (rate card).`,
      `${QC_DISPATCH_BUFFER_DAYS} day is added for QC and dispatch.`,
      'Rejected metres must be produced again; paused runs count as working once resumed.',
      'An order with no machine yet is estimated on the fastest free machine of its type.',
    ],
  };
}

// The buyer's timeline shows the delivery outlook in plain words, without the internal factors.
onTimeline(async (timeline, order) => {
  if (!OPEN_STATUSES.includes(order.status)) return;
  const { workingHoursPerDay } = await rateCardAt();
  const risk = await gather(order, { today: todayInIndia(), hoursPerDay: workingHoursPerDay });
  timeline.expectedDelivery.status = risk.level;
  timeline.expectedDelivery.message =
    risk.level === RISK_LEVEL.LATE
      ? risk.slackDays !== null && risk.daysLeft >= 0
        ? `Our current estimate is about ${plural(-risk.slackDays, 'day')} after the required date. We will contact you about a revised date.`
        : 'This order is behind schedule. We will contact you about a revised date.'
      : risk.level === RISK_LEVEL.AT_RISK
        ? 'The schedule is tight; we are watching this order closely.'
        : null;
});
