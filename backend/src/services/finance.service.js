import { Attendance } from '../models/Attendance.js';
import { Dispatch, DISPATCH_STATUS, Invoice } from '../models/Fulfilment.js';
import { InventoryTransaction } from '../models/InventoryTransaction.js';
import { MachineEvent } from '../models/MachineEvent.js';
import { Payment } from '../models/Payment.js';
import { Roll } from '../models/Roll.js';
import { YarnLot } from '../models/YarnLot.js';
import { AppError } from '../utils/AppError.js';
import { addDaysToDateString, startOfIndiaDay, todayInIndia } from '../utils/dates.js';
import { cmToMetres } from '../utils/units.js';
import { effectiveMaintenanceCosts } from './costing.service.js';

/*
 * The owner's month-end statement (ADMIN): did the mill make money this month? Every figure is a sum of
 * recorded records for one Indian calendar month; nothing is estimated or allocated.
 *
 *   Sales            invoices issued in the month, excluding GST (revenue is recognised at the invoice)
 *   Material used    yarn issued to production minus yarn returned, at each lot's purchase cost
 *   Stock write-offs negative stock adjustments (damaged / missing yarn) at lot cost
 *   Wages            the attendance register (server-computed wages)
 *   Maintenance      costs recorded when maintenance finished (corrections applied)
 *   Operating result = sales − material used − write-offs − wages − maintenance
 *
 * The cash view is shown separately (it is not profit): money received from buyers versus yarn bought
 * (receipts at cost; supplier payments are not tracked, so purchases are treated as paid when received),
 * wages and maintenance.
 * Order costing's machine-hour estimates (power, depreciation, overhead) are NOT included here: they are
 * rate-card estimates, and maintenance would otherwise be counted twice.
 */

const monthRange = (month) => {
  const from = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { from, to: addDaysToDateString(next, -1), start: startOfIndiaDay(from), end: startOfIndiaDay(next) };
};

async function lotCosts(ids) {
  const lots = await YarnLot.find({ _id: { $in: ids } }, { costPerKgPaise: 1 }).lean();
  return new Map(lots.map((l) => [String(l._id), l.costPerKgPaise]));
}

/** Cost of ledger movements: grams × each lot's cost per kg. */
async function movementCost(match) {
  const rows = await InventoryTransaction.aggregate([{ $match: match }, { $group: { _id: '$yarnLotId', grams: { $sum: '$deltaTotalGrams' } } }]);
  const cost = await lotCosts(rows.map((r) => r._id));
  return {
    grams: rows.reduce((s, r) => s + r.grams, 0),
    paise: rows.reduce((s, r) => s + Math.round((r.grams * (cost.get(String(r._id)) ?? 0)) / 1000), 0),
  };
}

export async function monthlyStatement(month) {
  if (month > todayInIndia().slice(0, 7)) throw new AppError('VALIDATION_ERROR', 'Request validation failed', { details: [{ location: 'query', path: 'month', message: 'cannot be in the future' }] });
  const { from, to, start, end } = monthRange(month);
  const inMonth = { $gte: start, $lt: end };

  const [invoices, payments, purchased, issued, returned, writeOffs, wages, maintenance, rolls, dispatched] = await Promise.all([
    Invoice.aggregate([{ $match: { issuedAt: inMonth } }, { $group: { _id: null, subtotal: { $sum: '$subtotalPaise' }, tax: { $sum: '$taxPaise' }, total: { $sum: '$totalPaise' }, count: { $sum: 1 } } }]),
    Payment.aggregate([{ $match: { receivedOn: { $gte: from, $lte: to } } }, { $group: { _id: null, amount: { $sum: '$amountPaise' }, count: { $sum: { $cond: [{ $gt: ['$amountPaise', 0] }, 1, 0] } } } }]),
    movementCost({ type: 'RECEIPT', createdAt: inMonth }),
    movementCost({ type: 'ISSUE', createdAt: inMonth }),
    movementCost({ type: 'RETURN', createdAt: inMonth }),
    movementCost({ type: 'ADJUSTMENT', deltaTotalGrams: { $lt: 0 }, createdAt: inMonth }),
    Attendance.aggregate([{ $match: { date: { $gte: from, $lte: to } } }, { $group: { _id: null, wages: { $sum: '$wagePaise' }, entries: { $sum: 1 } } }]),
    effectiveMaintenanceCosts({ start, end }),
    Roll.aggregate([{ $match: { createdAt: inMonth } }, { $group: { _id: '$status', cm: { $sum: '$lengthCm' }, count: { $sum: 1 } } }]),
    Dispatch.aggregate([{ $match: { status: DISPATCH_STATUS.CONFIRMED, confirmedAt: inMonth } }, { $group: { _id: null, cm: { $sum: '$totalLengthCm' }, count: { $sum: 1 } } }]),
  ]);

  const sales = invoices[0] ?? { subtotal: 0, tax: 0, total: 0, count: 0 };
  const materialUsedPaise = -(issued.paise + returned.paise); // issues are negative, returns positive
  const writeOffPaise = -writeOffs.paise;
  const wagesPaise = wages[0]?.wages ?? 0;
  const maintenancePaise = maintenance.reduce((s, m) => s + m.costPaise, 0);
  const costsPaise = materialUsedPaise + writeOffPaise + wagesPaise + maintenancePaise;
  const operatingResultPaise = sales.subtotal - costsPaise;
  const receivedPaise = payments[0]?.amount ?? 0;
  const cashOutPaise = purchased.paise + wagesPaise + maintenancePaise;
  const producedCm = rolls.reduce((s, r) => s + r.cm, 0);
  const rejectedCm = rolls.find((r) => r._id === 'REJECTED')?.cm ?? 0;

  return {
    month,
    period: { from, to },
    profit: {
      salesPaise: sales.subtotal,
      invoices: sales.count,
      gstInvoicedPaise: sales.tax,
      costs: { materialUsedPaise, writeOffPaise, wagesPaise, maintenancePaise, totalPaise: costsPaise },
      operatingResultPaise,
      marginPercent: sales.subtotal > 0 ? Math.round((operatingResultPaise / sales.subtotal) * 1000) / 10 : null,
      made: operatingResultPaise > 0 ? 'PROFIT' : operatingResultPaise < 0 ? 'LOSS' : 'BREAK_EVEN',
    },
    cash: { receivedFromBuyersPaise: receivedPaise, payments: payments[0]?.count ?? 0, yarnPurchasedPaise: purchased.paise, wagesPaise, maintenancePaise, netPaise: receivedPaise - cashOutPaise },
    production: {
      producedMetres: cmToMetres(producedCm),
      rolls: rolls.reduce((s, r) => s + r.count, 0),
      rejectedMetres: cmToMetres(rejectedCm),
      dispatchedMetres: cmToMetres(dispatched[0]?.cm ?? 0),
      dispatches: dispatched[0]?.count ?? 0,
      yarnUsedKg: Math.round(-(issued.grams + returned.grams)) / 1000,
      yarnPurchasedKg: Math.round(purchased.grams) / 1000,
    },
    notes: [
      'Sales = invoices issued this month, excluding GST. Payments received are cash, not revenue.',
      'Material used = yarn issued to production minus yarn returned, at each lot\'s purchase cost.',
      'Wages come from the attendance register; maintenance from costs recorded when maintenance finished.',
      'Machine-hour estimates (power, depreciation, overhead) from order costing are not included.',
      'Supplier payments are not tracked: yarn is counted as paid when received.',
    ],
  };
}

/** The last `months` months (oldest first), for the trend table. */
export async function monthlyTrend(months = 6) {
  const today = todayInIndia();
  let [y, m] = today.slice(0, 7).split('-').map(Number);
  const list = [];
  for (let i = 0; i < months; i += 1) {
    list.unshift(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) { m = 12; y -= 1; }
  }
  const statements = [];
  for (const month of list) statements.push(await monthlyStatement(month));
  return {
    months: statements.map((s) => ({
      month: s.month,
      salesPaise: s.profit.salesPaise,
      costsPaise: s.profit.costs.totalPaise,
      operatingResultPaise: s.profit.operatingResultPaise,
      receivedPaise: s.cash.receivedFromBuyersPaise,
      producedMetres: s.production.producedMetres,
    })),
  };
}
