import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { Machine } from '../../src/models/Machine.js';
import { MachineEvent } from '../../src/models/MachineEvent.js';
import { ProductionRun } from '../../src/models/ProductionRun.js';
import { User } from '../../src/models/User.js';
import { assessDeliveryRisk } from '../../src/services/intelligence.service.js';
import { addDaysToDateString } from '../../src/utils/dates.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { clearCatalog, createTestBuyer, createTestOrder, createTestProduct, daysFromToday, ensureCatalogCollections } from '../helpers/catalog.js';
import { clearInventory, ensureInventoryCollections } from '../helpers/inventory.js';

const TODAY = '2026-10-11';
const base = {
  status: 'IN_PRODUCTION',
  quantityCm: 500_000, // 5,000 m
  producedCm: 0,
  rejectedCm: 0,
  runs: [{ runNumber: 'RUN-1', status: 'RUNNING', machineCode: 'W-01', machineStatus: 'RUNNING', ratedCmPerHour: 2_000 }], // 20 m/h
  freeMachines: [],
  machineType: 'WEAVING',
  hoursPerDay: 16,
  today: TODAY,
};

describe('assessDeliveryRisk (pure rules)', () => {
  it('estimates days from remaining metres, machine speed and working hours, plus a QC/dispatch day', () => {
    // 5,000 m at 20 m/h = 250 h = 15.6 → 16 days of 16 h, + 1 day = 17 days.
    const risk = assessDeliveryRisk({ ...base, requiredBy: addDaysToDateString(TODAY, 30) });
    expect(risk).toMatchObject({ level: 'ON_TRACK', daysNeeded: 17, daysLeft: 30, slackDays: 13, expectedFinish: '2026-10-28', remainingMetres: 5000 });
    expect(risk.factors[0]).toMatchObject({ code: 'PRODUCTION_TIME' });
    expect(risk.factors[0].message).toMatch(/5,000 m still to produce: about 16 days on W-01/);
  });

  it('LATE when the estimate passes the required date, with a concrete fix', () => {
    const risk = assessDeliveryRisk({ ...base, requiredBy: addDaysToDateString(TODAY, 10), freeMachines: [{ code: 'W-02', ratedCmPerHour: 2_000 }] });
    expect(risk.level).toBe('LATE');
    // Two looms: 125 h → 8 days + 1 = 9 days.
    expect(risk.recommendations.map((r) => r.code)).toEqual(['ADD_MACHINE', 'TALK_TO_BUYER']);
    expect(risk.recommendations[0].message).toMatch(/W-02 .* about 9 days instead of 17/);
  });

  it('AT_RISK on thin slack or a blocking factor', () => {
    expect(assessDeliveryRisk({ ...base, requiredBy: addDaysToDateString(TODAY, 18) }).level).toBe('AT_RISK'); // 1 day slack
    const down = assessDeliveryRisk({ ...base, requiredBy: addDaysToDateString(TODAY, 60), runs: [{ ...base.runs[0], machineStatus: 'DOWN' }], freeMachines: [{ code: 'W-03', ratedCmPerHour: 1_000 }] });
    expect(down.level).toBe('AT_RISK');
    expect(down.factors.map((f) => f.code)).toContain('MACHINE_STOPPED');
    expect(down.recommendations[0]).toMatchObject({ code: 'FIX_MACHINE' });
  });

  it('counts rejected metres as work to redo and flags poor quality', () => {
    const risk = assessDeliveryRisk({ ...base, requiredBy: addDaysToDateString(TODAY, 40), producedCm: 500_000, rejectedCm: 100_000, rollsTotal: 5, rollsRejected: 1, rollsAwaitingQc: 2 });
    expect(risk.remainingMetres).toBe(1000);
    expect(risk.factors.map((f) => f.code)).toEqual(['PRODUCTION_TIME', 'REMAKE', 'QUALITY']);
    expect(risk.recommendations.map((r) => r.code)).toEqual(['CHECK_QUALITY', 'INSPECT']);
  });

  it('before production: material shortfall and planning advice', () => {
    const short = assessDeliveryRisk({ ...base, status: 'CONFIRMED', runs: [], freeMachines: [{ code: 'W-05', ratedCmPerHour: 2_000 }], materialShortfallGrams: 120_000, yarnLabel: 'cotton Navy yarn', requiredBy: addDaysToDateString(TODAY, 40) });
    expect(short.level).toBe('AT_RISK');
    expect(short.recommendations[0].message).toBe('Receive at least 120 kg of cotton Navy yarn, then reserve it for this order.');
    const reserved = assessDeliveryRisk({ ...base, status: 'MATERIAL_RESERVED', runs: [], freeMachines: [{ code: 'W-05', ratedCmPerHour: 2_000 }], requiredBy: addDaysToDateString(TODAY, 40) });
    expect(reserved.recommendations[0].message).toBe('Plan a run on W-05; it is free and finishes the order in about 16 days.');
    const none = assessDeliveryRisk({ ...base, status: 'MATERIAL_RESERVED', runs: [], requiredBy: addDaysToDateString(TODAY, 40) });
    expect(none).toMatchObject({ level: 'AT_RISK', daysNeeded: null });
    expect(none.factors[0].code).toBe('NO_MACHINE');
  });
});

describe('intelligence endpoints', () => {
  let app;
  let admin;
  let buyerUser;
  let order;
  let loom;

  beforeAll(async () => {
    await connectDatabase(process.env.MONGODB_URI);
    await ensureCatalogCollections();
    await ensureInventoryCollections();
  });

  beforeEach(async () => {
    app = createApp({ logger: captureLogs('silent').logger });
    admin = await createTestUser({ role: ROLES.ADMIN });
    const buyerCo = await createTestBuyer();
    buyerUser = await createTestUser({ role: ROLES.BUYER, buyerId: buyerCo._id });
    loom = await Machine.create({ code: 'W-I1', name: 'Loom', type: 'WEAVING', ratedCmPerHour: 2_000, status: 'RUNNING' });
    // 5,000 m due in 10 days on one 20 m/h loom → LATE (17 days needed).
    order = await createTestOrder({ buyer: buyerCo, product: await createTestProduct(), createdBy: admin._id, status: 'IN_PRODUCTION', quantityCm: 500_000, requiredBy: daysFromToday(10) });
    await ProductionRun.create({ runNumber: 'RUN-I-1', orderId: order._id, orderNumber: order.orderNumber, machineId: loom._id, machineCode: 'W-I1', targetCm: 500_000, status: 'RUNNING', supervisorId: admin._id });
  });

  afterEach(async () => {
    await clearCatalog();
    await clearInventory();
    await User.deleteMany({});
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('ranks open orders by risk with factors and recommendations', async () => {
    const res = await request(app).get('/api/intelligence/overview').set('Authorization', bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.data.counts).toEqual({ LATE: 1, AT_RISK: 0, ON_TRACK: 0 });
    expect(res.body.data.orders[0]).toMatchObject({ order: { orderNumber: order.orderNumber }, risk: { level: 'LATE', daysNeeded: 17 } });
    expect(res.body.data.assumptions.join(' ')).toMatch(/16 working hours/);
  });

  it('suggests preventive maintenance for machines with repeated problems', async () => {
    const problem = (severity) => ({ machineId: loom._id, type: 'PROBLEM_REPORTED', problem: { category: 'MECHANICAL', severity, description: 'Shuttle jam again' }, actorId: admin._id, actorRole: 'FLOOR_MANAGER' });
    await MachineEvent.create([problem('LOW'), problem('CRITICAL'), problem('MEDIUM')]);
    const { machines } = (await request(app).get('/api/intelligence/overview').set('Authorization', bearer(admin))).body.data;
    expect(machines).toEqual([expect.objectContaining({ code: 'W-I1', problems: 3, critical: 1 })]);
    expect(machines[0].recommendation).toMatch(/Schedule preventive maintenance/);
  });

  it('gives the buyer a plain delivery outlook without internal factors; planners only for details', async () => {
    const { timeline } = (await request(app).get(`/api/orders/${order._id}/timeline`).set('Authorization', bearer(buyerUser))).body.data;
    expect(timeline.expectedDelivery).toEqual({ requiredBy: daysFromToday(10), status: 'LATE', message: 'Our current estimate is about 7 days after the required date. We will contact you about a revised date.' });
    expect(JSON.stringify(timeline)).not.toMatch(/W-I1|RUN-I-1|factor/);
    expect((await request(app).get(`/api/intelligence/orders/${order._id}`).set('Authorization', bearer(buyerUser))).status).toBe(403);
    const qc = await createTestUser({ role: ROLES.QC_INSPECTOR });
    expect((await request(app).get('/api/intelligence/overview').set('Authorization', bearer(qc))).status).toBe(403);
    const one = (await request(app).get(`/api/intelligence/orders/${order._id}`).set('Authorization', bearer(admin))).body.data;
    expect(one.risk.level).toBe('LATE');
  });
});
