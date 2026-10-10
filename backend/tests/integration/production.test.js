import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { InventoryTransaction } from '../../src/models/InventoryTransaction.js';
import { Machine } from '../../src/models/Machine.js';
import { MachineEvent } from '../../src/models/MachineEvent.js';
import { Order } from '../../src/models/Order.js';
import { ProductionRun } from '../../src/models/ProductionRun.js';
import { Roll } from '../../src/models/Roll.js';
import { User } from '../../src/models/User.js';
import { YarnLot } from '../../src/models/YarnLot.js';
import { plannedCmForOrder } from '../../src/repositories/production.repository.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { clearCatalog, createTestBuyer, createTestOrder, createTestProduct, ensureCatalogCollections } from '../helpers/catalog.js';
import { clearInventory, ensureInventoryCollections, newKey } from '../helpers/inventory.js';

let app;
let admin;
let floor;
let store;
let buyerUser;
let buyerCo;
let product;
let loom; // WEAVING, AVAILABLE
let loom2;
let spinner; // SPINNING
let order; // 5,000 m Navy, CONFIRMED → reserved (850 kg) and 850 kg issued in beforeEach

const post = (actor, path, body = {}, key = newKey()) => request(app).post(path).set('Authorization', bearer(actor)).set('Idempotency-Key', key).send(body);
const get = (actor, path) => request(app).get(path).set('Authorization', bearer(actor));
const plan = (body, actor = floor) => post(actor, '/api/production-runs', { orderId: String(order._id), machineId: String(loom._id), targetMetres: 5000, ...body });
const runAct = (run, action, body = {}, actor = floor, key) => post(actor, `/api/production-runs/${run.id}/${action}`, body, key);
const roll = (run, lengthMetres, extra = {}) => runAct(run, 'rolls', { lengthMetres, ...extra });
const machineStatus = async (m) => (await Machine.findById(m._id).lean()).status;
const orderStatus = async () => (await Order.findById(order._id).lean()).status;

async function reservedOrder({ issueKg = 850, quantityCm = 500_000, requiredYarnGrams = 850_000 } = {}) {
  const lot = await YarnLot.create({
    lotNumber: `PRD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, material: 'COTTON', colour: 'Navy', supplierName: 'Supplier',
    costPerKgPaise: 1, receivedAt: new Date(Date.now() - 86_400_000), receivedBy: admin._id, totalGrams: 2_000_000,
  });
  await InventoryTransaction.create({ type: 'RECEIPT', yarnLotId: lot._id, deltaTotalGrams: 2_000_000, deltaReservedGrams: 0, actorId: admin._id });
  const created = await createTestOrder({ buyer: buyerCo, product, createdBy: admin._id, status: 'CONFIRMED', quantityCm, requiredYarnGrams });
  expect((await post(floor, `/api/orders/${created._id}/reserve`)).status).toBe(200);
  if (issueKg) expect((await post(store, `/api/orders/${created._id}/issue`, { quantityKg: issueKg })).status).toBe(200);
  return created;
}

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await ensureCatalogCollections();
  await ensureInventoryCollections();
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
  floor = await createTestUser({ role: ROLES.FLOOR_MANAGER });
  store = await createTestUser({ role: ROLES.STORE_KEEPER });
  buyerCo = await createTestBuyer();
  buyerUser = await createTestUser({ role: ROLES.BUYER, buyerId: buyerCo._id });
  product = await createTestProduct(); // machineType WEAVING (default)
  loom = await Machine.create({ code: 'W-01', name: 'Loom 1', type: 'WEAVING', ratedCmPerHour: 1500 });
  loom2 = await Machine.create({ code: 'W-02', name: 'Loom 2', type: 'WEAVING', ratedCmPerHour: 1500 });
  spinner = await Machine.create({ code: 'S-01', name: 'Spinner', type: 'SPINNING', ratedCmPerHour: 4000 });
  order = await reservedOrder();
});

afterEach(async () => {
  await clearCatalog();
  await clearInventory();
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('plannedCmForOrder', () => {
  it('counts open runs by target, completed runs by output, cancelled runs not at all', () => {
    expect(plannedCmForOrder([
      { status: 'PLANNED', targetCm: 100, producedCm: 0 },
      { status: 'RUNNING', targetCm: 200, producedCm: 50 },
      { status: 'COMPLETED', targetCm: 300, producedCm: 280 },
      { status: 'CANCELLED', targetCm: 999, producedCm: 0 },
    ])).toBe(580);
  });
});

describe('plan a run', () => {
  it('books a machine of the fabric\'s type: run PLANNED, machine ASSIGNED, history and audit', async () => {
    const res = await plan({ targetMetres: 3000 });
    expect(res.status).toBe(201);
    expect(res.body.data.run).toMatchObject({ runNumber: expect.stringMatching(/^RUN-\d{4}-0001$/), status: 'PLANNED', targetMetres: 3000, producedMetres: 0, machineCode: 'W-01' });
    const machine = await Machine.findById(loom._id).lean();
    expect(machine).toMatchObject({ status: 'ASSIGNED' });
    expect(String(machine.currentRunId)).toBe(res.body.data.run.id);
    expect(await MachineEvent.countDocuments({ machineId: loom._id, toStatus: 'ASSIGNED' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'RUN_PLANNED' })).toBe(1);
  });

  it('can split an order across machines, but never plan more than the order', async () => {
    expect((await plan({ targetMetres: 2000 })).status).toBe(201);
    expect((await plan({ machineId: String(loom2._id), targetMetres: 3000 })).status).toBe(201);
    const third = await Machine.create({ code: 'W-03', name: 'Loom 3', type: 'WEAVING', ratedCmPerHour: 1500 });
    const res = await plan({ machineId: String(third._id), targetMetres: 1 });
    expect(res.body.error).toMatchObject({ code: 'QUANTITY_EXCEEDS_ORDER', details: { remainingMetres: 0 } });
  });

  it('refuses a machine of the wrong type (400), a busy machine (409) and an order without reserved yarn (409)', async () => {
    expect((await plan({ machineId: String(spinner._id) })).body.error.details[0].message).toMatch(/SPINNING machine; this fabric is made on WEAVING/);
    await Machine.updateOne({ _id: loom._id }, { $set: { status: 'MAINTENANCE' } });
    expect((await plan()).body.error).toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { from: 'MAINTENANCE' } });
    const confirmedOnly = await createTestOrder({ buyer: buyerCo, product, createdBy: admin._id, status: 'CONFIRMED' });
    expect((await post(floor, '/api/production-runs', { orderId: String(confirmedOnly._id), machineId: String(loom2._id), targetMetres: 10 })).body.error.code).toBe('CONFLICT');
  });

  it.each([ROLES.STORE_KEEPER, ROLES.QC_INSPECTOR, ROLES.BUYER])('is forbidden for %s', async (role) => {
    const actor = role === ROLES.BUYER ? buyerUser : await createTestUser({ role });
    expect((await plan({}, actor)).status).toBe(403);
  });
});

describe('start, pause, resume', () => {
  let run;
  beforeEach(async () => {
    run = (await plan()).body.data.run;
  });

  it('starts: run and machine RUNNING, order goes IN_PRODUCTION', async () => {
    const res = await runAct(run, 'start');
    expect(res.status).toBe(200);
    expect(res.body.data.run).toMatchObject({ status: 'RUNNING', startedAt: expect.any(String) });
    expect(res.body.data.order.status).toBe('IN_PRODUCTION');
    expect(await machineStatus(loom)).toBe('RUNNING');
    expect((await Order.findById(order._id).lean()).statusHistory.at(-1)).toMatchObject({ from: 'MATERIAL_RESERVED', to: 'IN_PRODUCTION', byRole: 'FLOOR_MANAGER' });
  });

  it('refuses to start before any yarn is on the floor (409 YARN_NOT_ISSUED)', async () => {
    await clearOrderAndRun();
    order = await reservedOrder({ issueKg: 0 });
    const fresh = (await plan()).body.data.run;
    expect((await runAct(fresh, 'start')).body.error.code).toBe('YARN_NOT_ISSUED');
    expect(await orderStatus()).toBe('MATERIAL_RESERVED');
  });

  it('a DOWN machine cannot start its run; after repair it can', async () => {
    const problem = (await post(floor, `/api/machines/${loom._id}/problems`, { category: 'ELECTRICAL', severity: 'CRITICAL', description: 'Drive tripped' })).body.data.event;
    expect(await machineStatus(loom)).toBe('DOWN');
    expect((await runAct(run, 'start')).body.error).toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { machineStatus: 'DOWN' } });
    await post(floor, `/api/machines/${loom._id}/problems/${problem.id}/resolve`, { resolution: 'Relay replaced' });
    expect(await machineStatus(loom)).toBe('ASSIGNED');
    expect((await runAct(run, 'start')).status).toBe(200);
  });

  it('pauses and resumes run and machine together; a reason is required to pause', async () => {
    await runAct(run, 'start');
    expect((await runAct(run, 'pause', {})).status).toBe(400);
    const paused = await runAct(run, 'pause', { reason: 'Shift change' });
    expect(paused.body.data.run.status).toBe('PAUSED');
    expect(await machineStatus(loom)).toBe('PAUSED');
    expect((await runAct(run, 'resume')).body.data.run.status).toBe('RUNNING');
    expect(await machineStatus(loom)).toBe('RUNNING');
  });

  it('a critical machine problem pauses the run; it resumes only after the repair', async () => {
    await runAct(run, 'start');
    const problem = (await post(floor, `/api/machines/${loom._id}/problems`, { category: 'MECHANICAL', severity: 'CRITICAL', description: 'Shuttle jammed' })).body.data.event;
    expect((await ProductionRun.findById(run.id).lean()).status).toBe('PAUSED');
    expect((await runAct(run, 'resume')).body.error).toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { machineStatus: 'DOWN' } });
    await post(floor, `/api/machines/${loom._id}/problems/${problem.id}/resolve`, { resolution: 'Jam cleared' });
    expect(await machineStatus(loom)).toBe('PAUSED');
    expect((await runAct(run, 'resume')).body.data.run.status).toBe('RUNNING');
  });

  it('a non-critical problem with "pause production" pauses the run too', async () => {
    await runAct(run, 'start');
    await post(floor, `/api/machines/${loom._id}/problems`, { category: 'QUALITY', severity: 'LOW', description: 'Minor weft marks', pauseProduction: true });
    expect((await ProductionRun.findById(run.id).lean()).status).toBe('PAUSED');
  });

  it('replays a retried start instead of starting twice', async () => {
    const key = newKey();
    await runAct(run, 'start', {}, floor, key);
    const retry = await runAct(run, 'start', {}, floor, key);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(await AuditLog.countDocuments({ action: 'RUN_STARTED' })).toBe(1);
  });

  async function clearOrderAndRun() {
    await runAct(run, 'cancel', { reason: 'Test reset' });
  }
});

describe('output and completion', () => {
  let run;
  beforeEach(async () => {
    run = (await plan()).body.data.run;
    await runAct(run, 'start');
  });

  it('records rolls with their traceability; the run adds up its output', async () => {
    const first = await roll(run, 120.5, { weightKg: 21.25 });
    expect(first.status).toBe(201);
    expect(first.body.data.roll).toMatchObject({
      rollNumber: expect.stringMatching(/^ROLL-\d{4}-00001$/), status: 'QC_PENDING', lengthMetres: 120.5, weightKg: 21.25,
      orderNumber: order.orderNumber, runNumber: run.runNumber, machineCode: 'W-01',
    });
    expect(first.body.data.roll.yarnLots).toHaveLength(1);
    expect((await roll(run, 100)).body.data.roll.weightKg).toBeNull(); // weight is optional
    const detail = (await get(store, `/api/production-runs/${run.id}`)).body.data;
    expect(detail.run).toMatchObject({ producedMetres: 220.5, rollCount: 2 });
    expect(detail.rolls.map((r) => r.lengthMetres)).toEqual([120.5, 100]);
  });

  it('refuses output on a run that is not producing, and bad lengths', async () => {
    const other = await reservedOrder();
    const planned = (await post(floor, '/api/production-runs', { orderId: String(other._id), machineId: String(loom2._id), targetMetres: 100 })).body.data.run;
    expect((await roll(planned, 10)).body.error).toMatchObject({ code: 'CONFLICT', details: { status: 'PLANNED' } });
    expect((await roll(run, 0)).status).toBe(400);
    expect((await roll(run, 10.555)).status).toBe(400);
  });

  it('cannot complete without output (409 NO_OUTPUT_RECORDED)', async () => {
    expect((await runAct(run, 'complete')).body.error.code).toBe('NO_OUTPUT_RECORDED');
  });

  it('completing the run that covers the order frees the machine and completes production', async () => {
    await roll(run, 2500);
    await roll(run, 2500);
    const res = await runAct(run, 'complete', { note: 'Target reached' });
    expect(res.body.data.run).toMatchObject({ status: 'COMPLETED', completedAt: expect.any(String) });
    expect(res.body.data.order.status).toBe('PRODUCTION_COMPLETED');
    expect(await machineStatus(loom)).toBe('AVAILABLE');
    expect((await Machine.findById(loom._id).lean()).currentRunId).toBeNull();
  });

  it('a short run leaves the order IN_PRODUCTION; the next run completes it', async () => {
    await roll(run, 3000);
    expect((await runAct(run, 'complete')).body.data.order.status).toBe('IN_PRODUCTION');
    const second = (await plan({ machineId: String(loom2._id), targetMetres: 2000 })).body.data.run;
    await runAct(second, 'start');
    await roll(second, 2000);
    expect((await runAct(second, 'complete')).body.data.order.status).toBe('PRODUCTION_COMPLETED');
  });

  it('a running run cannot be cancelled; an IN_PRODUCTION order cannot be cancelled', async () => {
    expect((await runAct(run, 'cancel', { reason: 'Changed mind' })).body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect((await post(buyerUser, `/api/orders/${order._id}/cancel`, { reason: 'Changed mind' })).body.error.code).toBe('INVALID_STATE_TRANSITION');
  });
});

describe('concurrency', () => {
  it('two runs completing at the same moment still complete the order (no lost update)', async () => {
    const a = (await plan({ targetMetres: 2500 })).body.data.run;
    const b = (await plan({ machineId: String(loom2._id), targetMetres: 2500 })).body.data.run;
    for (const run of [a, b]) {
      expect((await runAct(run, 'start')).status).toBe(200);
      expect((await roll(run, 2500)).status).toBe(201);
    }
    const results = await Promise.all([runAct(a, 'complete'), runAct(b, 'complete')]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await orderStatus()).toBe('PRODUCTION_COMPLETED');
    expect(await machineStatus(loom)).toBe('AVAILABLE');
    expect(await machineStatus(loom2)).toBe('AVAILABLE');
  });
});

describe('cancelling', () => {
  it('cancels a planned run and frees its machine', async () => {
    const run = (await plan()).body.data.run;
    const res = await runAct(run, 'cancel', { reason: 'Machine needed elsewhere' });
    expect(res.body.data.run.status).toBe('CANCELLED');
    expect(await machineStatus(loom)).toBe('AVAILABLE');
    expect((await plan({ machineId: String(loom2._id) })).status).toBe(201); // the quantity is free again
  });

  it('cancelling a reserved order cancels its planned runs and frees the machines', async () => {
    const run = (await plan()).body.data.run;
    const res = await post(buyerUser, `/api/orders/${order._id}/cancel`, { reason: 'Buyer changed plans' });
    expect(res.status).toBe(200);
    expect((await ProductionRun.findById(run.id).lean()).status).toBe('CANCELLED');
    expect(await machineStatus(loom)).toBe('AVAILABLE');
  });
});

describe('reading runs', () => {
  it('lists runs with filters for internal roles; buyers cannot', async () => {
    await plan({ targetMetres: 1000 });
    expect((await get(store, `/api/production-runs?orderId=${order._id}`)).body.meta.total).toBe(1);
    expect((await get(store, '/api/production-runs?status=RUNNING')).body.meta.total).toBe(0);
    expect((await get(buyerUser, '/api/production-runs')).status).toBe(403);
    expect(await Roll.countDocuments()).toBe(0);
  });
});
