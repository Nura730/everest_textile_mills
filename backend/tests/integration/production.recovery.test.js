import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { InventoryTransaction } from '../../src/models/InventoryTransaction.js';
import { Machine } from '../../src/models/Machine.js';
import { Order } from '../../src/models/Order.js';
import { ProductionRun } from '../../src/models/ProductionRun.js';
import { Roll } from '../../src/models/Roll.js';
import { User } from '../../src/models/User.js';
import { YarnLot } from '../../src/models/YarnLot.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { clearCatalog, createTestBuyer, createTestOrder, createTestProduct, ensureCatalogCollections } from '../helpers/catalog.js';
import { clearInventory, ensureInventoryCollections, newKey } from '../helpers/inventory.js';
import { SIGNED } from '../helpers/signature.js';

/*
 * Recovery from a run completed by mistake: the order needs 500 m, the floor completed the run at
 * 400 m. Reopening must let the floor finish the remaining 100 m with no duplicate rolls, stock or
 * audit, and only in the narrow case it is meant for.
 */

let app;
let admin;
let floor;
let store;
let qc;
let order;
let loom;
let run;

const post = (actor, path, body = {}, key = newKey()) => request(app).post(path).set('Authorization', bearer(actor)).set('Idempotency-Key', key).send(body);
const act = (action, body = {}, actor = floor, key) => post(actor, `/api/production-runs/${run.id}/${action}`, body, key);
const reopen = (reason = 'Completed by mistake at 400 m', actor = floor, key) => act('reopen', { reason }, actor, key);

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
  qc = await createTestUser({ role: ROLES.QC_INSPECTOR });
  const lot = await YarnLot.create({ lotNumber: 'GRN-REC-1', material: 'COTTON', colour: 'Navy', supplierName: 'S', costPerKgPaise: 1, receivedAt: new Date(Date.now() - 86_400_000), receivedBy: admin._id, totalGrams: 1_000_000 });
  await InventoryTransaction.create({ type: 'RECEIPT', yarnLotId: lot._id, deltaTotalGrams: 1_000_000, deltaReservedGrams: 0, actorId: admin._id });
  order = await createTestOrder({ buyer: await createTestBuyer(), product: await createTestProduct(), createdBy: admin._id, status: 'CONFIRMED', quantityCm: 50_000, requiredYarnGrams: 85_000 });
  expect((await post(floor, `/api/orders/${order._id}/reserve`)).status).toBe(200);
  expect((await post(store, `/api/orders/${order._id}/issue`, { quantityKg: 85 })).status).toBe(200);
  loom = await Machine.create({ code: 'W-R1', name: 'Loom', type: 'WEAVING', ratedCmPerHour: 1500 });
  run = (await post(floor, '/api/production-runs', { orderId: String(order._id), machineId: String(loom._id), targetMetres: 500 })).body.data.run;
  await act('start');
  await act('rolls', { lengthMetres: 200 });
  await act('rolls', { lengthMetres: 200 });
  // the mistake: completed at 400 of 500 m (a shortfall reason is now required, so it was a deliberate-looking click)
  expect((await act('complete')).body.error.code).toBe('SHORTFALL_REASON_REQUIRED');
  expect((await act('complete', { shortfallReason: 'Thought the roll was the last one' })).body.data.run).toMatchObject({ status: 'COMPLETED', producedMetres: 400 });
});

afterEach(async () => {
  await clearCatalog();
  await clearInventory();
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('reopening a run completed by mistake', () => {
  it('500 m order completed at 400 m: reopen, resume, produce 100 m, complete — no duplicates, full history', async () => {
    expect((await Order.findById(order._id).lean()).status).toBe('IN_PRODUCTION');
    const key = newKey();
    const res = await reopen('Completed by mistake at 400 m', floor, key);
    expect(res.status).toBe(200);
    expect(res.body.data.run).toMatchObject({ status: 'PAUSED', producedMetres: 400, completedAt: null });
    expect((await reopen('Completed by mistake at 400 m', floor, key)).headers['idempotent-replayed']).toBe('true');
    expect((await Machine.findById(loom._id).lean())).toMatchObject({ status: 'PAUSED', currentRunId: expect.anything() });

    expect((await act('resume')).body.data.run.status).toBe('RUNNING');
    expect((await act('rolls', { lengthMetres: 100 })).status).toBe(201);
    const done = await act('complete');
    expect(done.body.data.run).toMatchObject({ status: 'COMPLETED', producedMetres: 500 });
    expect(done.body.data.order.status).toBe('PRODUCTION_COMPLETED');

    expect(await Roll.countDocuments({ orderId: order._id })).toBe(3);
    expect(await ProductionRun.countDocuments({ orderId: order._id })).toBe(1);
    // stock moved only by the original issue: reopening touches no inventory
    expect(await InventoryTransaction.countDocuments({ type: 'ISSUE' })).toBe(1);
    const history = (await ProductionRun.findById(run.id).lean()).statusHistory.map((h) => h.to);
    expect(history).toEqual(['PLANNED', 'RUNNING', 'COMPLETED', 'PAUSED', 'RUNNING', 'COMPLETED']);
    const audit = await AuditLog.findOne({ action: 'RUN_REOPENED' }).lean();
    expect(audit).toMatchObject({ actorRole: 'FLOOR_MANAGER', before: { status: 'COMPLETED', producedCm: 40_000, targetCm: 50_000 }, after: { status: 'PAUSED', reason: 'Completed by mistake at 400 m', runRemainingCm: 10_000, orderRemainingCm: 10_000 } });
    expect(await AuditLog.countDocuments({ action: 'RUN_REOPENED' })).toBe(1);
  });

  it('never produces beyond the order (the remaining 100 m is the limit)', async () => {
    await reopen();
    await act('resume');
    const over = await act('rolls', { lengthMetres: 150 });
    expect(over.status).toBe(409);
    expect(over.body.error).toMatchObject({ code: 'QUANTITY_EXCEEDS_ORDER', details: { remainingMetres: 100 } });
    expect(await Roll.countDocuments({ orderId: order._id })).toBe(2);
  });

  it('rejected metres can be remade: they do not count toward the limit', async () => {
    const rolls = await Roll.find({ orderId: order._id }).lean();
    await post(qc, `/api/rolls/${rolls[0]._id}/inspections`, { result: 'REJECT', defects: [{ type: 'HOLES', severity: 'CRITICAL' }], signature: SIGNED });
    await reopen();
    await act('resume');
    expect((await act('rolls', { lengthMetres: 300 })).status).toBe(201); // 200 good + 300 = 500
    expect((await act('rolls', { lengthMetres: 1 })).status).toBe(409);
  });

  it('the continuation alternative still works: plan a new run for the remaining 100 m', async () => {
    const loom2 = await Machine.create({ code: 'W-R2', name: 'Loom 2', type: 'WEAVING', ratedCmPerHour: 1500 });
    const plan = await post(floor, '/api/production-runs', { orderId: String(order._id), machineId: String(loom2._id), targetMetres: 100 });
    expect(plan.status).toBe(201);
    expect((await post(floor, '/api/production-runs', { orderId: String(order._id), machineId: String(loom._id), targetMetres: 1 })).body.error.code).toBe('QUANTITY_EXCEEDS_ORDER');
    // with the gap already planned, reopening is refused (it would double-plan the 100 m)
    expect((await reopen()).body.error).toMatchObject({ code: 'QUANTITY_EXCEEDS_ORDER', details: { reason: 'GAP_ALREADY_PLANNED' } });
  });

  it('refuses everything outside the narrow case', async () => {
    // reason required
    expect((await act('reopen', { reason: 'x' })).status).toBe(400);
    // roles: store keeper, QC and buyer cannot
    for (const actor of [store, qc]) expect((await reopen(undefined, actor)).status).toBe(403);
    // machine busy with another run
    const other = await createTestOrder({ buyer: await createTestBuyer(), product: await createTestProduct(), createdBy: admin._id, status: 'MATERIAL_RESERVED' });
    await Machine.updateOne({ _id: loom._id }, { $set: { status: 'ASSIGNED', currentRunId: other._id } });
    expect((await reopen()).body.error.details.reason).toBe('MACHINE_NOT_AVAILABLE');
    await Machine.updateOne({ _id: loom._id }, { $set: { status: 'AVAILABLE', currentRunId: null } });
    // a run that met its target cannot be reopened
    await ProductionRun.updateOne({ _id: run.id }, { $set: { producedCm: 50_000 } });
    expect((await reopen()).body.error.details.reason).toBe('RUN_REACHED_TARGET');
    await ProductionRun.updateOne({ _id: run.id }, { $set: { producedCm: 40_000 } });
    // an order that moved on (e.g. production completed) cannot be pulled back
    await Order.updateOne({ _id: order._id }, { $set: { status: 'PRODUCTION_COMPLETED' } });
    expect((await reopen()).body.error.details.reason).toBe('ORDER_NOT_IN_PRODUCTION');
    // a running run is not "completed": nothing to reopen
    await Order.updateOne({ _id: order._id }, { $set: { status: 'IN_PRODUCTION' } });
    await reopen();
    expect((await reopen()).body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect(await AuditLog.countDocuments({ action: 'RUN_REOPENED' })).toBe(1);
  });
});

describe('more yarn for a continuation run', () => {
  const topUp = (body, actor = floor, key) => post(actor, `/api/orders/${order._id}/reserve-additional`, body, key);

  it('reserves free stock oldest-first with a reason; ledger and audit once; retries replay', async () => {
    const key = newKey();
    const res = await topUp({ quantityKg: 20, reason: 'Continuation run for the last 100 m' }, floor, key);
    expect(res.status).toBe(200);
    expect(res.body.data.reservations).toEqual([expect.objectContaining({ lotNumber: 'GRN-REC-1', reservedKg: 20 })]);
    expect((await topUp({ quantityKg: 20, reason: 'Continuation run for the last 100 m' }, floor, key)).headers['idempotent-replayed']).toBe('true');
    expect(await InventoryTransaction.countDocuments({ type: 'RESERVATION', reason: 'Continuation run for the last 100 m' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'MATERIAL_RESERVED_ADDITIONAL' })).toBe(1);
    const lot = await YarnLot.findOne({ lotNumber: 'GRN-REC-1' }).lean();
    expect(lot.reservedGrams).toBe(20_000); // 85 kg reserved then issued (reserved back to 0), + 20 kg
  });

  it('never takes yarn reserved for another order, and explains a shortage exactly', async () => {
    // 1000 kg received, 85 issued → 915 free. Another order reserves 900 of it.
    const other = await createTestOrder({ buyer: await createTestBuyer(), product: await createTestProduct(), createdBy: admin._id, status: 'CONFIRMED', quantityCm: 500_000, requiredYarnGrams: 900_000 });
    expect((await post(floor, `/api/orders/${other._id}/reserve`)).status).toBe(200);
    const res = await topUp({ quantityKg: 50, reason: 'Remake two rejected rolls' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_STOCK', details: { requestedKg: 50, availableKg: 15, shortfallKg: 35 } });
    expect(res.body.error.message).toMatch(/store keeper can receive it/);
    expect((await YarnLot.findOne({ lotNumber: 'GRN-REC-1' }).lean()).reservedGrams).toBe(900_000);
  });

  it('refuses bad amounts, wrong order states and other roles', async () => {
    expect((await topUp({ quantityKg: 0, reason: 'Nothing at all' })).status).toBe(400);
    expect((await topUp({ quantityKg: 1.2345, reason: 'Too precise here' })).status).toBe(400);
    expect((await topUp({ quantityKg: 86, reason: 'More than a full requirement' })).status).toBe(400); // order needs 85 kg
    expect((await topUp({ quantityKg: 5 })).status).toBe(400); // reason required
    for (const actor of [store, qc]) expect((await topUp({ quantityKg: 5, reason: 'Not my job here' }, actor)).status).toBe(403);
    await Order.updateOne({ _id: order._id }, { $set: { status: 'PRODUCTION_COMPLETED' } });
    expect((await topUp({ quantityKg: 5, reason: 'Order already produced' })).body.error.code).toBe('INVALID_STATE_TRANSITION');
  });
});
