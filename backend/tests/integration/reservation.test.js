import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { InventoryTransaction } from '../../src/models/InventoryTransaction.js';
import { MaterialReservation } from '../../src/models/MaterialReservation.js';
import { Order } from '../../src/models/Order.js';
import { User } from '../../src/models/User.js';
import { YarnLot } from '../../src/models/YarnLot.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { clearCatalog, createTestBuyer, createTestOrder, createTestProduct, ensureCatalogCollections } from '../helpers/catalog.js';
import { clearInventory, ensureInventoryCollections, newKey } from '../helpers/inventory.js';

let app;
let admin;
let store;
let floor;
let buyerUser;
let buyerCo;
let product;
let order; // CONFIRMED, 5,000 m Navy cotton = 850 kg

let lotSeq = 0;
/** A lot plus the ledger rows the real flows would have written, so reconciliation stays meaningful. */
async function addLot({ kg, daysAgo, colour = 'Navy', material = 'COTTON', reservedKg = 0 }) {
  lotSeq += 1;
  const lot = await YarnLot.create({
    lotNumber: `RSV-${String(lotSeq).padStart(3, '0')}`,
    material,
    colour,
    supplierName: 'Sri Lakshmi Spinners',
    costPerKgPaise: 32000,
    receivedAt: new Date(Date.now() - daysAgo * 86_400_000),
    receivedBy: admin._id,
    totalGrams: kg * 1000,
    reservedGrams: reservedKg * 1000,
  });
  await InventoryTransaction.create({ type: 'RECEIPT', yarnLotId: lot._id, deltaTotalGrams: kg * 1000, deltaReservedGrams: 0, actorId: admin._id });
  if (reservedKg) {
    await InventoryTransaction.create({ type: 'RESERVATION', yarnLotId: lot._id, deltaTotalGrams: 0, deltaReservedGrams: reservedKg * 1000, actorId: admin._id });
  }
  return lot;
}

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await ensureCatalogCollections();
  await ensureInventoryCollections();
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
  store = await createTestUser({ role: ROLES.STORE_KEEPER });
  floor = await createTestUser({ role: ROLES.FLOOR_MANAGER });
  buyerCo = await createTestBuyer();
  buyerUser = await createTestUser({ role: ROLES.BUYER, buyerId: buyerCo._id });
  product = await createTestProduct();
  order = await createTestOrder({ buyer: buyerCo, product, createdBy: admin._id, status: 'CONFIRMED' });
});

afterEach(async () => {
  await clearCatalog();
  await clearInventory();
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

const post = (actor, path, body = {}, key = newKey()) => request(app).post(path).set('Authorization', bearer(actor)).set('Idempotency-Key', key).send(body);
// Reserving yarn for production is the floor manager's job (the store issues and returns it).
const reserve = (actor = floor, body = {}, key) => post(actor, `/api/orders/${order._id}/reserve`, body, key);
const issue = (quantityKg, actor = store) => post(actor, `/api/orders/${order._id}/issue`, { quantityKg });
const giveBack = (quantityKg, reason = 'Unused cones back from loom 3', actor = store) => post(actor, `/api/orders/${order._id}/return`, { quantityKg, reason });
const lotKg = async (lot) => {
  const doc = await YarnLot.findById(lot._id).lean();
  return { total: doc.totalGrams / 1000, reserved: doc.reservedGrams / 1000 };
};
const reconciled = async () => (await request(app).get('/api/inventory/reconciliation').set('Authorization', bearer(admin))).body.data.balanced;

describe('POST /api/orders/:id/reserve — automatic (oldest lots first)', () => {
  it('reserves the whole requirement across lots FIFO and moves the order to MATERIAL_RESERVED', async () => {
    const older = await addLot({ kg: 500, daysAgo: 10 });
    const newer = await addLot({ kg: 1000, daysAgo: 2 });

    const res = await reserve();

    expect(res.status).toBe(200);
    expect(res.body.data.order.status).toBe('MATERIAL_RESERVED');
    expect(res.body.data.reservations.map((r) => [r.lotNumber, r.reservedKg, r.status])).toEqual([
      [older.lotNumber, 500, 'ACTIVE'],
      [newer.lotNumber, 350, 'ACTIVE'],
    ]);
    expect(await lotKg(older)).toEqual({ total: 500, reserved: 500 });
    expect(await lotKg(newer)).toEqual({ total: 1000, reserved: 350 });

    const rows = await InventoryTransaction.find({ type: 'RESERVATION' }).lean();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => String(row.orderId) === String(order._id) && row.reservationId && row.deltaTotalGrams === 0)).toBe(true);
    expect(await AuditLog.findOne({ action: 'MATERIAL_RESERVED' }).lean()).toMatchObject({ after: { totalGrams: 850_000, mode: 'FIFO' } });
    expect((await Order.findById(order._id).lean()).statusHistory.at(-1)).toMatchObject({ from: 'CONFIRMED', to: 'MATERIAL_RESERVED', byRole: 'FLOOR_MANAGER' });
    expect(await reconciled()).toBe(true);
  });

  it('refuses with 409 INSUFFICIENT_STOCK when the lots together fall short, and stores nothing', async () => {
    await addLot({ kg: 500, daysAgo: 5 });
    await addLot({ kg: 600, daysAgo: 4, reservedKg: 300 }); // only 300 available
    await addLot({ kg: 5000, daysAgo: 3, colour: 'Red' }); // wrong colour never counts

    const res = await reserve();

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_STOCK', details: { requiredKg: 850, availableKg: 800, shortfallKg: 50 } });
    expect(await MaterialReservation.countDocuments()).toBe(0);
    expect((await Order.findById(order._id).lean()).status).toBe('CONFIRMED');
    expect(await InventoryTransaction.countDocuments({ type: 'RESERVATION', orderId: order._id })).toBe(0);
  });

  it('replays a retried reservation instead of reserving twice', async () => {
    await addLot({ kg: 1000, daysAgo: 1 });
    const key = newKey();
    await reserve(floor, {}, key);
    const retry = await reserve(floor, {}, key);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(await MaterialReservation.countDocuments()).toBe(1);
  });

  it('lets only one of two orders win the same kilograms when reserving at the same moment', async () => {
    await addLot({ kg: 1000, daysAgo: 1 });
    const other = await createTestOrder({ buyer: buyerCo, product, createdBy: admin._id, status: 'CONFIRMED' });

    const results = await Promise.all([reserve(), post(floor, `/api/orders/${other._id}/reserve`)]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await YarnLot.findOne().lean()).reservedGrams).toBe(850_000);
    expect(await reconciled()).toBe(true);
  });

  it.each(['ORDER_CREATED', 'CANCELLED', 'REJECTED'])('cannot reserve for a %s order (409)', async (status) => {
    await addLot({ kg: 1000, daysAgo: 1 });
    await Order.updateOne({ _id: order._id }, { $set: { status } });
    expect((await reserve()).body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('cannot reserve twice', async () => {
    await addLot({ kg: 2000, daysAgo: 1 });
    await reserve();
    expect((await reserve()).body.error).toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { from: 'MATERIAL_RESERVED' } });
  });

  it.each([ROLES.STORE_KEEPER, ROLES.QC_INSPECTOR, ROLES.BUYER])('is forbidden for %s', async (role) => {
    const actor = role === ROLES.BUYER ? buyerUser : await createTestUser({ role });
    expect((await reserve(actor)).status).toBe(403);
  });
});

describe('POST /api/orders/:id/reserve — the floor manager picks lots', () => {
  let a;
  let b;
  beforeEach(async () => {
    a = await addLot({ kg: 500, daysAgo: 10 });
    b = await addLot({ kg: 1000, daysAgo: 2 });
  });
  const pick = (allocations) => reserve(floor, { allocations });

  it('uses the chosen lots and amounts (not FIFO)', async () => {
    const res = await pick([{ yarnLotId: String(b._id), quantityKg: 850 }]);
    expect(res.status).toBe(200);
    expect(await lotKg(a)).toEqual({ total: 500, reserved: 0 });
    expect(await lotKg(b)).toEqual({ total: 1000, reserved: 850 });
    expect(await AuditLog.findOne({ action: 'MATERIAL_RESERVED' }).lean()).toMatchObject({ after: { mode: 'MANUAL' } });
  });

  it.each([
    ['amounts not adding up to the requirement', () => [{ yarnLotId: String(b._id), quantityKg: 800 }], 'allocations'],
    ['the same lot twice', () => [{ yarnLotId: String(b._id), quantityKg: 425 }, { yarnLotId: String(b._id), quantityKg: 425 }], 'allocations'],
    ['an unknown lot', () => [{ yarnLotId: '64b7f0c2a1b2c3d4e5f60718', quantityKg: 850 }], 'allocations.0.yarnLotId'],
    ['more than 3 decimals', () => [{ yarnLotId: String(b._id), quantityKg: 850.0001 }], 'allocations.0.quantityKg'],
  ])('returns 400 for %s and changes nothing', async (_label, build, path) => {
    const res = await pick(build());
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.path)).toContain(path);
    expect(await MaterialReservation.countDocuments()).toBe(0);
  });

  it('refuses a lot of the wrong colour (400)', async () => {
    const red = await addLot({ kg: 1000, daysAgo: 1, colour: 'Red' });
    const res = await pick([{ yarnLotId: String(red._id), quantityKg: 850 }]);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].message).toMatch(/COTTON Red; this order needs COTTON Navy/);
  });

  it('refuses more than a lot has available (409) and rolls back the lots already reserved', async () => {
    const res = await pick([
      { yarnLotId: String(b._id), quantityKg: 250 },
      { yarnLotId: String(a._id), quantityKg: 600 }, // a holds only 500
    ]);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_STOCK', details: { lotNumber: a.lotNumber } });
    expect(await lotKg(b)).toEqual({ total: 1000, reserved: 0 });
    expect(await MaterialReservation.countDocuments()).toBe(0);
  });
});

describe('reserved yarn is protected', () => {
  it('another order\'s feasibility and reservation no longer see it as available', async () => {
    await addLot({ kg: 1000, daysAgo: 1 });
    await reserve();
    const other = await createTestOrder({ buyer: buyerCo, product, createdBy: admin._id });
    const feasibility = (await request(app).get(`/api/orders/${other._id}/feasibility`).set('Authorization', bearer(floor))).body.data.feasibility;
    expect(feasibility.inputs).toMatchObject({ stockReservedKg: 850, stockAvailableKg: 150, committedKg: 0 });
    expect(feasibility.status).toBe('NOT_FEASIBLE');
  });

  it('an adjustment cannot write off reserved yarn', async () => {
    const lot = await addLot({ kg: 1000, daysAgo: 1 });
    await reserve();
    const res = await post(admin, `/api/yarn-lots/${lot._id}/adjustments`, { deltaKg: -200, reason: 'Water damage' });
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_STOCK', details: { maxReductionKg: 150 } });
  });
});

describe('issue, return, release', () => {
  let a;
  let b;
  beforeEach(async () => {
    a = await addLot({ kg: 500, daysAgo: 10 });
    b = await addLot({ kg: 1000, daysAgo: 2 });
    await reserve(); // a: 500 reserved, b: 350 reserved
  });

  it('issues reserved yarn to the floor (oldest reservation first); stock and reservation both drop', async () => {
    const res = await issue(600);

    expect(res.status).toBe(200);
    expect(res.body.data.totals).toMatchObject({ reservedKg: 850, issuedKg: 600, openKg: 250, onFloorKg: 600 });
    expect(res.body.data.reservations.map((r) => r.status)).toEqual(['FULLY_ISSUED', 'PARTIALLY_ISSUED']);
    expect(await lotKg(a)).toEqual({ total: 0, reserved: 0 });
    expect(await lotKg(b)).toEqual({ total: 900, reserved: 250 });
    expect(await InventoryTransaction.countDocuments({ type: 'ISSUE', orderId: order._id })).toBe(2);
    expect((await Order.findById(order._id).lean()).status).toBe('MATERIAL_RESERVED');
    expect(await reconciled()).toBe(true);
  });

  it('cannot issue more than is still reserved (409) and changes nothing', async () => {
    const res = await issue(851);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_STOCK', details: { openKg: 850 } });
    expect(await lotKg(b)).toEqual({ total: 1000, reserved: 350 });
  });

  it('cannot issue for an order whose yarn is not reserved', async () => {
    const confirmed = await createTestOrder({ buyer: buyerCo, product, createdBy: admin._id, status: 'CONFIRMED' });
    expect((await post(store, `/api/orders/${confirmed._id}/issue`, { quantityKg: 1 })).body.error.code).toBe('CONFLICT');
  });

  it('returns unused yarn to the lots, up to what is on the floor; reason required', async () => {
    await issue(600);
    const res = await giveBack(150);

    expect(res.status).toBe(200);
    expect(res.body.data.totals).toMatchObject({ issuedKg: 600, returnedKg: 150, onFloorKg: 450 });
    expect(await lotKg(a)).toEqual({ total: 150, reserved: 0 }); // returned to the lot it came from
    expect((await giveBack(451)).body.error).toMatchObject({ code: 'QUANTITY_EXCEEDS_ISSUED', details: { onFloorKg: 450 } });
    expect((await post(store, `/api/orders/${order._id}/return`, { quantityKg: 1 })).status).toBe(400);
    expect(await reconciled()).toBe(true);
  });

  it('cancelling a reserved order releases only what is not yet issued; issued yarn can still come back', async () => {
    await issue(600);
    const cancel = await post(buyerUser, `/api/orders/${order._id}/cancel`, { reason: 'Buyer changed plans' });

    expect(cancel.status).toBe(200);
    expect(cancel.body.data.order.status).toBe('CANCELLED');
    expect(await lotKg(b)).toEqual({ total: 900, reserved: 0 });
    const reservations = await MaterialReservation.find({ orderId: order._id }).sort({ createdAt: 1 }).lean();
    expect(reservations.map((r) => [r.status, r.releasedGrams])).toEqual([['FULLY_ISSUED', 0], ['RELEASED', 250_000]]);
    expect(await InventoryTransaction.findOne({ type: 'RESERVATION_RELEASE' }).lean()).toMatchObject({ deltaReservedGrams: -250_000, reason: 'Buyer changed plans' });
    expect(await AuditLog.countDocuments({ action: 'MATERIAL_RELEASED' })).toBe(1);

    expect((await giveBack(600, 'Order cancelled, all cones back')).status).toBe(200);
    expect(await lotKg(a)).toEqual({ total: 500, reserved: 0 });
    expect(await lotKg(b)).toEqual({ total: 1000, reserved: 0 });
    expect(await reconciled()).toBe(true);
  });

  it('shows the order\'s reservations to planning roles only', async () => {
    const path = `/api/orders/${order._id}/reservations`;
    const res = await request(app).get(path).set('Authorization', bearer(floor));
    expect(res.status).toBe(200);
    expect(res.body.data.totals).toMatchObject({ reservedKg: 850, openKg: 850 });
    expect((await request(app).get(path).set('Authorization', bearer(buyerUser))).status).toBe(403);
  });

  it('a lot\'s ledger can be filtered to one order\'s movements', async () => {
    await issue(100);
    const res = await request(app).get(`/api/yarn-lots/${a._id}/transactions?orderId=${order._id}`).set('Authorization', bearer(store));
    expect(res.body.data.transactions.map((t) => t.type)).toEqual(['ISSUE', 'RESERVATION']);
    expect(res.body.data.transactions.every((t) => t.orderId === String(order._id))).toBe(true);
  });
});
