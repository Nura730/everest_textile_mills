import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { Invoice } from '../../src/models/Fulfilment.js';
import { InventoryTransaction } from '../../src/models/InventoryTransaction.js';
import { Machine } from '../../src/models/Machine.js';
import { Order } from '../../src/models/Order.js';
import { ProductionRun } from '../../src/models/ProductionRun.js';
import { RateCard } from '../../src/models/RateCard.js';
import { Roll } from '../../src/models/Roll.js';
import { User } from '../../src/models/User.js';
import { YarnLot } from '../../src/models/YarnLot.js';
import { runningHours } from '../../src/services/costing.service.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { clearCatalog, createTestBuyer, createTestOrder, createTestProduct, ensureCatalogCollections } from '../helpers/catalog.js';
import { clearInventory, ensureInventoryCollections } from '../helpers/inventory.js';

const H = 3_600_000;
const T0 = new Date('2026-10-01T04:00:00Z');
const at = (hours) => new Date(T0.getTime() + hours * H);

describe('runningHours', () => {
  it('counts only RUNNING time from the run history (pauses excluded)', () => {
    const run = {
      status: 'COMPLETED',
      statusHistory: [{ to: 'PLANNED', at: at(-5) }, { to: 'RUNNING', at: at(0) }, { to: 'PAUSED', at: at(2) }, { to: 'RUNNING', at: at(3) }, { to: 'COMPLETED', at: at(4) }],
    };
    expect(runningHours(run)).toBe(3);
  });

  it('counts a still-running run up to now', () => {
    expect(runningHours({ status: 'RUNNING', statusHistory: [{ to: 'RUNNING', at: at(0) }] }, at(1.5))).toBe(1.5);
  });
});

describe('order cost sheet', () => {
  let app;
  let admin;
  let order;

  beforeAll(async () => {
    await connectDatabase(process.env.MONGODB_URI);
    await ensureCatalogCollections();
    await ensureInventoryCollections();
  });

  beforeEach(async () => {
    app = createApp({ logger: captureLogs('silent').logger });
    admin = await createTestUser({ role: ROLES.ADMIN });
    order = await createTestOrder({ buyer: await createTestBuyer(), product: await createTestProduct(), createdBy: admin._id, status: 'INVOICED' }); // value ₹9,00,000
    const lot = await YarnLot.create({ lotNumber: 'GRN-COST-1', material: 'COTTON', colour: 'Navy', supplierName: 'S', costPerKgPaise: 32_000, receivedAt: T0, receivedBy: admin._id, totalGrams: 0 });
    // 850 kg issued, 100 kg returned → 750 kg × ₹320 = ₹2,40,000
    await InventoryTransaction.create({ type: 'ISSUE', yarnLotId: lot._id, orderId: order._id, deltaTotalGrams: -850_000, deltaReservedGrams: -850_000, actorId: admin._id });
    await InventoryTransaction.create({ type: 'RETURN', yarnLotId: lot._id, orderId: order._id, deltaTotalGrams: 100_000, deltaReservedGrams: 0, actorId: admin._id });
    const machine = await Machine.create({ code: 'W-C', name: 'Loom', type: 'WEAVING', ratedCmPerHour: 1500 });
    const run = await ProductionRun.create({
      runNumber: 'RUN-C-1', orderId: order._id, orderNumber: order.orderNumber, machineId: machine._id, machineCode: 'W-C', targetCm: 500_000, producedCm: 500_000,
      status: 'COMPLETED', supervisorId: admin._id, startedAt: at(0),
      statusHistory: [{ to: 'PLANNED', at: at(-1), by: admin._id, byRole: 'ADMIN' }, { to: 'RUNNING', at: at(0), by: admin._id, byRole: 'ADMIN' }, { to: 'PAUSED', at: at(2), by: admin._id, byRole: 'ADMIN' }, { to: 'RUNNING', at: at(3), by: admin._id, byRole: 'ADMIN' }, { to: 'COMPLETED', at: at(4), by: admin._id, byRole: 'ADMIN' }],
    });
    const rollBase = { orderId: order._id, orderNumber: order.orderNumber, runId: run._id, runNumber: run.runNumber, machineId: machine._id, machineCode: 'W-C', producedBy: admin._id };
    await Roll.create({ ...rollBase, rollNumber: 'ROLL-C-1', lengthCm: 400_000, status: 'FINISHED', reworkCount: 1 });
    await Roll.create({ ...rollBase, rollNumber: 'ROLL-C-2', lengthCm: 100_000, status: 'REJECTED' });
    await Invoice.create({ invoiceNumber: 'INV-C-1', orderId: order._id, orderNumber: order.orderNumber, dispatchId: run._id, dispatchNumber: 'DSP-C-1', buyerId: order.buyerId, buyer: { code: 'B', name: 'B' }, lines: [], subtotalPaise: 72_000_000, taxRateBasisPoints: 500, taxPaise: 3_600_000, totalPaise: 75_600_000, issuedBy: admin._id });
  });

  afterEach(async () => {
    await clearCatalog();
    await clearInventory();
    await User.deleteMany({});
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  const cost = async (actor = admin) => request(app).get(`/api/costing/orders/${order._id}`).set('Authorization', bearer(actor));

  it('builds the cost from actual yarn cost, running hours, rework and overhead, against invoiced revenue', async () => {
    const res = await cost();
    expect(res.status).toBe(200);
    const sheet = res.body.data;
    // Default rates: labour ₹120/h, weaving ₹60/h, rework ₹250/roll, overhead 8%.
    expect(sheet.cost).toEqual({
      materialPaise: 24_000_000, // 750 kg × ₹320
      labourPaise: 36_000, // 3 h × ₹120
      machinePaise: 18_000, // 3 h × ₹60
      reworkPaise: 25_000, // 1 round × ₹250
      overheadPaise: Math.round((24_079_000 * 800) / 10_000), // 8% of direct
      totalPaise: 24_079_000 + Math.round((24_079_000 * 800) / 10_000),
    });
    expect(sheet.revenue).toEqual({ kind: 'INVOICED', amountPaise: 72_000_000 });
    expect(sheet.profitPaise).toBe(72_000_000 - sheet.cost.totalPaise);
    expect(sheet.marginPercent).toBeCloseTo(((72_000_000 - sheet.cost.totalPaise) / 72_000_000) * 100, 1);
    expect(sheet.detail.runs[0]).toMatchObject({ hours: 3 });
    expect(sheet.detail.material[0]).toMatchObject({ lotNumber: 'GRN-COST-1', kg: 750 });
    // 1,000 m of 5,000 m was rejected: a fifth of material + labour + machine went into waste.
    expect(sheet.waste).toEqual({ rejectedMetres: 1000, producedMetres: 5000, costInRejectedPaise: Math.round(24_054_000 / 5) });
    expect(sheet.rateCard).toMatchObject({ version: 0, isDefault: true });
    expect(sheet.assumptions.length).toBeGreaterThan(5);
  });

  it('before invoicing, revenue is the order value marked as expected', async () => {
    await Invoice.deleteMany({});
    await Order.updateOne({ _id: order._id }, { $set: { status: 'IN_PRODUCTION' } });
    expect((await cost()).body.data.revenue).toEqual({ kind: 'EXPECTED', amountPaise: 90_000_000 });
  });

  it('saves rate cards as new versions; costs use the version in force when production started', async () => {
    const saved = await request(app).post('/api/costing/rates').set('Authorization', bearer(admin)).send({
      labourPaisePerHour: 20_000, machinePaisePerHour: { SPINNING: 1, WEAVING: 10_000, DYEING: 1, FINISHING: 1 }, reworkPaisePerRoll: 0, overheadBasisPoints: 0, workingHoursPerDay: 20, note: 'FY27 rates',
    });
    expect(saved.body.data.rateCard).toMatchObject({ version: 1, labourPaisePerHour: 20_000 });
    // This order started before version 1 existed, so it keeps the defaults.
    expect((await cost()).body.data.rateCard.version).toBe(0);
    await RateCard.collection.updateOne({ version: 1 }, { $set: { effectiveFrom: at(-10) } });
    expect((await cost()).body.data.cost.labourPaise).toBe(60_000);
    const rates = (await request(app).get('/api/costing/rates').set('Authorization', bearer(admin))).body.data;
    expect(rates.current.version).toBe(1);
    expect(rates.history).toHaveLength(1);
    await expect(RateCard.updateOne({}, { $set: { labourPaisePerHour: 1 } })).rejects.toThrow(/append-only/);
  });

  it('summarises profitability across orders; owner-only', async () => {
    const summary = (await request(app).get('/api/costing/summary').set('Authorization', bearer(admin))).body.data;
    expect(summary.orders).toHaveLength(1);
    expect(summary.totals.invoicedRevenuePaise).toBe(72_000_000);
    const overview = (await request(app).get('/api/costing/overview').set('Authorization', bearer(admin))).body.data;
    expect(overview.orders.INVOICED).toBe(1);
    expect(overview.revenue.invoicedPaise).toBe(72_000_000);
    for (const role of [ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.BUYER]) {
      expect((await cost(await createTestUser({ role }))).status).toBe(403);
    }
  });

  it('rejects invalid rates', async () => {
    const res = await request(app).post('/api/costing/rates').set('Authorization', bearer(admin)).send({ labourPaisePerHour: -1, machinePaisePerHour: { WEAVING: 1 }, reworkPaisePerRoll: 0, overheadBasisPoints: 20_000, workingHoursPerDay: 30 });
    expect(res.status).toBe(400);
  });
});
