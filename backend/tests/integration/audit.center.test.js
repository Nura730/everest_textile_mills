import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { FinishedGood } from '../../src/models/Fulfilment.js';
import { Order } from '../../src/models/Order.js';
import { ProductionRun } from '../../src/models/ProductionRun.js';
import { Roll } from '../../src/models/Roll.js';
import { User } from '../../src/models/User.js';
import { bearer, captureLogs, createTestUser, TEST_PASSWORD } from '../helpers/auth.js';
import { clearCatalog, createTestBuyer, createTestOrder, createTestProduct, daysFromToday, ensureCatalogCollections } from '../helpers/catalog.js';
import { clearInventory, ensureInventoryCollections } from '../helpers/inventory.js';

let app;
let admin;
let store;
let floor;
let qc;
let buyerUser;
let otherBuyer;
let order;
let otherOrder;

const entry = (action, extra = {}) =>
  AuditLog.collection.insertOne({
    action, actorId: admin._id, actorRole: 'ADMIN', entityType: 'Thing', entityId: order._id, orderId: null, machineId: null,
    before: null, after: null, source: 'ONLINE', at: new Date(), ...extra,
  });

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await ensureCatalogCollections();
  await ensureInventoryCollections();
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN, name: 'Asha Admin' });
  store = await createTestUser({ role: ROLES.STORE_KEEPER });
  floor = await createTestUser({ role: ROLES.FLOOR_MANAGER });
  qc = await createTestUser({ role: ROLES.QC_INSPECTOR });
  const buyerCo = await createTestBuyer();
  const otherCo = await createTestBuyer();
  buyerUser = await createTestUser({ role: ROLES.BUYER, buyerId: buyerCo._id });
  otherBuyer = await createTestUser({ role: ROLES.BUYER, buyerId: otherCo._id });
  const product = await createTestProduct();
  order = await createTestOrder({ buyer: buyerCo, product, createdBy: admin._id });
  otherOrder = await createTestOrder({ buyer: otherCo, product, createdBy: admin._id });

  await entry('MATERIAL_RECEIVED', { after: { lotNumber: 'GRN-1', totalGrams: 1000, costPerKgPaise: 32000 } });
  await entry('STOCK_ADJUSTED');
  await entry('MACHINE_PROBLEM_REPORTED', { actorRole: 'FLOOR_MANAGER' });
  await entry('RUN_STARTED', { orderId: order._id });
  await entry('QC_REJECTED', { orderId: order._id });
  await entry('ORDER_CREATED', { orderId: order._id, after: { orderNumber: order.orderNumber, orderValuePaise: 90_000_000, quantityCm: 500_000 } });
  await entry('ORDER_CONFIRMED', { orderId: otherOrder._id });
  await entry('INVOICE_ISSUED', { orderId: order._id, after: { totalPaise: 5 } });
  await entry('BUYER_CREATED', { at: new Date(Date.now() - 10 * 86_400_000) });
});

afterEach(async () => {
  await clearCatalog();
  await clearInventory();
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

const list = async (actor, query = '') => (await request(app).get(`/api/audit${query}`).set('Authorization', bearer(actor))).body;
const actions = (body) => body.data.entries.map((e) => e.action).sort();

describe('audit visibility by role', () => {
  it('the admin sees everything, with before/after and actor names', async () => {
    const body = await list(admin);
    expect(body.meta.total).toBe(9);
    const created = body.data.entries.find((e) => e.action === 'ORDER_CREATED');
    expect(created).toMatchObject({ actorName: 'Asha Admin', after: { orderValuePaise: 90_000_000 } });
  });

  it('the store keeper sees inventory work, without cost figures', async () => {
    const body = await list(store);
    expect(actions(body)).toEqual(['MATERIAL_RECEIVED', 'STOCK_ADJUSTED']);
    expect(body.data.entries.find((e) => e.action === 'MATERIAL_RECEIVED').after).toEqual({ lotNumber: 'GRN-1', totalGrams: 1000 });
    expect(body.data.entries[0].actorId).toBeNull();
  });

  it('the floor manager sees machines and production', async () => {
    expect(actions(await list(floor))).toEqual(['MACHINE_PROBLEM_REPORTED', 'RUN_STARTED']);
  });

  it('QC sees QC, production, machine problems and the order lifecycle, without money', async () => {
    const body = await list(qc);
    expect(actions(body)).toEqual(['MACHINE_PROBLEM_REPORTED', 'ORDER_CONFIRMED', 'ORDER_CREATED', 'QC_REJECTED', 'RUN_STARTED']);
    expect(body.data.entries.find((e) => e.action === 'ORDER_CREATED').after).toEqual({ orderNumber: order.orderNumber, quantityCm: 500_000 });
  });

  it('a buyer sees only milestones of their own orders, in plain words, with no internals', async () => {
    const body = await list(buyerUser);
    expect(actions(body)).toEqual(['INVOICE_ISSUED', 'ORDER_CREATED', 'RUN_STARTED']);
    const started = body.data.entries.find((e) => e.action === 'RUN_STARTED');
    expect(started).toEqual({ id: expect.any(String), action: 'RUN_STARTED', label: 'Production started', orderId: String(order._id), at: expect.any(String) });
    expect(actions(await list(otherBuyer))).toEqual(['ORDER_CONFIRMED']);
  });

  it('asking for a hidden action or another company\'s order returns nothing, not an error', async () => {
    expect((await list(buyerUser, '?action=STOCK_ADJUSTED')).meta.total).toBe(0);
    expect((await list(buyerUser, `?orderId=${otherOrder._id}`)).meta.total).toBe(0);
    expect((await list(store, '?action=ORDER_CREATED')).meta.total).toBe(0);
  });
});

describe('admin filters and corrections', () => {
  it('filters by role, action, order and date', async () => {
    expect((await list(admin, '?actorRole=FLOOR_MANAGER')).meta.total).toBe(1);
    expect((await list(admin, '?action=QC_REJECTED')).meta.total).toBe(1);
    expect((await list(admin, `?orderId=${order._id}`)).meta.total).toBe(4);
    expect((await list(admin, `?to=${daysFromToday(-5)}`)).meta.total).toBe(1);
    expect((await request(app).get('/api/audit?action=drop table').set('Authorization', bearer(admin))).status).toBe(400);
  });

  it('a correction is a new entry pointing at the original, which stays unchanged', async () => {
    const original = (await list(admin, '?action=STOCK_ADJUSTED')).data.entries[0];
    const res = await request(app).post(`/api/audit/${original.id}/corrections`).set('Authorization', bearer(admin)).send({ note: 'Recount was entered on the wrong lot' });
    expect(res.status).toBe(201);
    expect(res.body.data.entry).toMatchObject({ action: 'AUDIT_CORRECTION', correctsAuditId: original.id, after: { note: 'Recount was entered on the wrong lot' } });
    expect(await AuditLog.countDocuments({ action: 'STOCK_ADJUSTED' })).toBe(1);
    expect((await request(app).post(`/api/audit/${original.id}/corrections`).set('Authorization', bearer(store)).send({ note: 'Not allowed here' })).status).toBe(403);
  });

  it('administrative changes are audited (account created, deactivated)', async () => {
    const created = await request(app).post('/api/users').set('Authorization', bearer(admin)).send({ name: 'New Inspector', email: 'new.qc@everest.test', password: TEST_PASSWORD, role: 'QC_INSPECTOR' });
    await request(app).patch(`/api/users/${created.body.data.user.id}/status`).set('Authorization', bearer(admin)).send({ isActive: false });
    expect(await AuditLog.countDocuments({ action: 'USER_CREATED' })).toBe(1);
    expect(await AuditLog.findOne({ action: 'USER_STATUS_CHANGED' }).lean()).toMatchObject({ after: { isActive: false, tokensRevoked: true } });
  });
});

describe('buyer timeline', () => {
  it('shows stages, production and QC progress and expected delivery for the owner only', async () => {
    await Order.updateOne({ _id: order._id }, {
      $set: { status: 'PRODUCTION_COMPLETED' },
      $push: { statusHistory: { $each: ['CONFIRMED', 'MATERIAL_RESERVED', 'IN_PRODUCTION', 'PRODUCTION_COMPLETED'].map((to) => ({ to, at: new Date(), by: admin._id, byRole: 'ADMIN' })) } },
    });
    const run = await ProductionRun.create({ runNumber: 'RUN-TL-1', orderId: order._id, orderNumber: order.orderNumber, machineId: admin._id, machineCode: 'W-1', targetCm: 500_000, producedCm: 300_000, status: 'COMPLETED', supervisorId: admin._id });
    await Roll.create({ rollNumber: 'ROLL-TL-1', orderId: order._id, orderNumber: order.orderNumber, runId: run._id, runNumber: run.runNumber, machineId: admin._id, machineCode: 'W-1', lengthCm: 100_000, producedBy: admin._id, status: 'QC_PENDING' });
    await FinishedGood.create({ rollId: admin._id, rollNumber: 'ROLL-TL-0', orderId: order._id, orderNumber: order.orderNumber, buyerId: order.buyerId, buyerName: 'B', productName: 'P', material: 'COTTON', colour: 'Navy', lengthCm: 200_000 });

    const res = await request(app).get(`/api/orders/${order._id}/timeline`).set('Authorization', bearer(buyerUser));
    const { timeline } = res.body.data;
    expect(timeline.progress).toEqual({ orderedMetres: 5000, producedMetres: 3000, producedPercent: 60, qcPassedMetres: 2000, rollsAwaitingQc: 1, dispatchedMetres: 0 });
    expect(timeline.stages.map((s) => [s.key, s.state])).toEqual([
      ['CONFIRMED', 'done'], ['MATERIAL', 'done'], ['PRODUCTION', 'done'], ['QC', 'current'], ['READY', 'upcoming'], ['DISPATCHED', 'upcoming'], ['INVOICED', 'upcoming'],
    ]);
    expect(timeline.stages.find((s) => s.key === 'QC').detail).toBe('2000 m passed, 1 roll still being checked');
    expect(timeline.expectedDelivery.requiredBy).toBe(order.requiredBy.toISOString().slice(0, 10));
    expect(JSON.stringify(timeline)).not.toMatch(/machine|lot|cost|W-1/i);
    expect((await request(app).get(`/api/orders/${order._id}/timeline`).set('Authorization', bearer(otherBuyer))).status).toBe(404);
  });
});
