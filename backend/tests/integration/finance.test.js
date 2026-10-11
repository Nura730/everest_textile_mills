import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { Attendance } from '../../src/models/Attendance.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { Invoice } from '../../src/models/Fulfilment.js';
import { IdempotencyRecord } from '../../src/models/IdempotencyRecord.js';
import { InventoryTransaction } from '../../src/models/InventoryTransaction.js';
import { Machine } from '../../src/models/Machine.js';
import { MachineEvent } from '../../src/models/MachineEvent.js';
import { Payment } from '../../src/models/Payment.js';
import { Roll } from '../../src/models/Roll.js';
import { User } from '../../src/models/User.js';
import { YarnLot } from '../../src/models/YarnLot.js';
import { todayInIndia } from '../../src/utils/dates.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { newKey } from '../helpers/inventory.js';

let app;
let admin;
let floor;
let loom;
const id = () => new mongoose.Types.ObjectId();
const today = todayInIndia();
const month = today.slice(0, 7);
const now = new Date();
const lastMonth = new Date(Date.now() - 40 * 86_400_000);
const get = (actor, path) => request(app).get(path).set('Authorization', bearer(actor));
const post = (actor, path, body, key = newKey()) => request(app).post(path).set('Authorization', bearer(actor)).set('Idempotency-Key', key).send(body);

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await Promise.all([User.init(), Machine.init(), MachineEvent.init(), IdempotencyRecord.init(), AuditLog.createCollection(), Payment.init(), Invoice.init()]);
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
  floor = await createTestUser({ role: ROLES.FLOOR_MANAGER });
  loom = await Machine.create({ code: 'W-F1', name: 'Loom', type: 'WEAVING', ratedCmPerHour: 1500 });
});

afterEach(async () => {
  await Promise.all([
    Machine.deleteMany({}), MachineEvent.collection.deleteMany({}), AuditLog.collection.deleteMany({}), IdempotencyRecord.deleteMany({}), User.deleteMany({}),
    Invoice.deleteMany({}), Payment.collection.deleteMany({}), InventoryTransaction.collection.deleteMany({}), YarnLot.deleteMany({}), Attendance.deleteMany({}), Roll.deleteMany({}),
  ]);
});

afterAll(async () => {
  await disconnectDatabase();
});

async function finishMaintenance(costPaise, extra = {}) {
  await post(floor, `/api/machines/${loom._id}/maintenance/start`, {});
  return post(floor, `/api/machines/${loom._id}/maintenance/end`, { costPaise, ...extra });
}

describe('maintenance details and cost corrections', () => {
  it('records category, supplier reference and downtime when maintenance finishes', async () => {
    const res = await finishMaintenance(120_000, { category: 'PARTS_REPLACEMENT', reference: 'BILL-77' });
    expect(res.body.data.event).toMatchObject({ costPaise: 120_000, maintenanceCategory: 'PARTS_REPLACEMENT', reference: 'BILL-77', downtimeMinutes: expect.any(Number) });
    expect((await post(floor, `/api/machines/${loom._id}/maintenance/start`, {})).status).toBe(200);
    expect((await post(floor, `/api/machines/${loom._id}/maintenance/end`, { costPaise: 0, category: 'MAGIC' })).status).toBe(400);
  });

  it('the admin corrects a cost with a reason; reports use the latest figure, never both', async () => {
    const ended = (await finishMaintenance(120_000)).body.data.event;
    const path = `/api/machines/${loom._id}/maintenance/${ended.id}/cost-correction`;
    expect((await post(floor, path, { costPaise: 100_000, reason: 'Bill was lower' })).status).toBe(403);
    expect((await post(admin, path, { costPaise: 100_000 })).status).toBe(400); // reason required
    expect((await post(admin, path, { costPaise: -1, reason: 'Negative amount' })).status).toBe(400);
    expect((await post(admin, path, { costPaise: 100_000, reason: 'Supplier bill was ₹1,000' })).status).toBe(201);
    expect((await post(admin, path, { costPaise: 100_000, reason: 'Same again' })).status).toBe(400); // nothing changes
    expect((await post(admin, path, { costPaise: 110_000, reason: 'Freight added later' })).status).toBe(201);
    const summary = (await get(admin, '/api/costing/summary')).body.data.factoryExpenses.maintenance;
    expect(summary).toMatchObject({ totalPaise: 110_000, jobs: 1 });
    expect(await MachineEvent.countDocuments({ type: 'MAINTENANCE_ENDED' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'MACHINE_MAINTENANCE_COST_CORRECTED' })).toBe(2);
    expect((await post(admin, `/api/machines/${loom._id}/maintenance/${id()}/cost-correction`, { costPaise: 1, reason: 'Unknown event' })).status).toBe(404);
  });
});

describe('monthly statement', () => {
  it('adds up the month from the records: sales, material, wages, maintenance, cash and production', async () => {
    // sales: one invoice this month (₹10,000 + GST), one last month (ignored)
    const inv = { orderId: id(), orderNumber: 'O', dispatchId: id(), dispatchNumber: 'D', buyerId: id(), buyer: { code: 'B', name: 'B' }, lines: [], taxRateBasisPoints: 500, issuedBy: id() };
    const thisMonth = await Invoice.create({ ...inv, invoiceNumber: 'INV-F1', subtotalPaise: 1_000_000, taxPaise: 50_000, totalPaise: 1_050_000, issuedAt: now });
    await Invoice.create({ ...inv, invoiceNumber: 'INV-F0', dispatchId: id(), subtotalPaise: 9_999_900, taxPaise: 0, totalPaise: 9_999_900, issuedAt: lastMonth });
    // cash: ₹4,000 received
    expect((await post(admin, `/api/invoices/${thisMonth._id}/payments`, { amountPaise: 400_000, receivedOn: today, method: 'UPI' })).status).toBe(201);
    // yarn: 100 kg bought at ₹300/kg; 20 kg issued, 2 kg returned, 1 kg written off
    const lot = await YarnLot.create({ lotNumber: 'GRN-F', material: 'COTTON', colour: 'Navy', supplierName: 'S', costPerKgPaise: 30_000, receivedAt: now, receivedBy: admin._id, totalGrams: 77_000 });
    const tx = (type, deltaTotalGrams) => ({ type, yarnLotId: lot._id, deltaTotalGrams, deltaReservedGrams: 0, actorId: admin._id });
    await InventoryTransaction.create([tx('RECEIPT', 100_000), tx('ISSUE', -20_000), tx('RETURN', 2_000), tx('ADJUSTMENT', -1_000)]);
    // wages ₹1,200, maintenance ₹500
    await Attendance.create({ workerId: id(), workerCode: 'W', workerName: 'W', department: 'GENERAL', date: today, status: 'PRESENT', wageBasis: 'DAILY', ratePaise: 120_000, halfDayFactorBp: 5000, wagePaise: 120_000, recordedBy: admin._id, recordedByRole: 'ADMIN' });
    await finishMaintenance(50_000);
    // production: 300 m, 50 m of it rejected
    const roll = (n, cm, status) => ({ rollNumber: `R-${n}`, orderId: id(), orderNumber: 'O', runId: id(), runNumber: 'RUN', machineId: loom._id, machineCode: loom.code, lengthCm: cm, status, producedBy: floor._id });
    await Roll.create([roll(1, 25_000, 'QC_PASSED'), roll(2, 5_000, 'REJECTED')]);

    const res = await get(admin, `/api/finance/monthly?month=${month}`);
    expect(res.status).toBe(200);
    const s = res.body.data;
    expect(s.profit).toMatchObject({
      salesPaise: 1_000_000,
      invoices: 1,
      costs: { materialUsedPaise: 540_000, writeOffPaise: 30_000, wagesPaise: 120_000, maintenancePaise: 50_000, totalPaise: 740_000 },
      operatingResultPaise: 260_000,
      made: 'PROFIT',
    });
    expect(s.cash).toMatchObject({ receivedFromBuyersPaise: 400_000, yarnPurchasedPaise: 3_000_000, netPaise: 400_000 - 3_000_000 - 120_000 - 50_000 });
    expect(s.production).toMatchObject({ producedMetres: 300, rejectedMetres: 50, rolls: 2, yarnUsedKg: 18, yarnPurchasedKg: 100 });
  });

  it('admin only; month validated; trend lists the last months', async () => {
    expect((await get(floor, `/api/finance/monthly?month=${month}`)).status).toBe(403);
    expect((await get(admin, '/api/finance/monthly?month=2026-13')).status).toBe(400);
    expect((await get(admin, '/api/finance/monthly?month=2999-01')).status).toBe(400);
    const trend = (await get(admin, '/api/finance/trend?months=3')).body.data.months;
    expect(trend).toHaveLength(3);
    expect(trend.at(-1).month).toBe(month);
  });
});
