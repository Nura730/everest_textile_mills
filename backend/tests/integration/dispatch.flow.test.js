import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { Dispatch, FinishedGood } from '../../src/models/Fulfilment.js';
import { InventoryTransaction } from '../../src/models/InventoryTransaction.js';
import { Machine } from '../../src/models/Machine.js';
import { ProductionRun } from '../../src/models/ProductionRun.js';
import { Roll } from '../../src/models/Roll.js';
import { User } from '../../src/models/User.js';
import { YarnLot } from '../../src/models/YarnLot.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { clearCatalog, createTestBuyer, createTestOrder, createTestProduct, ensureCatalogCollections } from '../helpers/catalog.js';
import { clearInventory, ensureInventoryCollections, newKey } from '../helpers/inventory.js';
import { SIGNED } from '../helpers/signature.js';

/*
 * Regression for "production complete, Ready for dispatch, but Prepare dispatch says no finished
 * goods": the whole path through the real API, order → production → QC → finished goods → dispatch,
 * and the one availability rule both dispatch screens use.
 */

let app;
let admin;
let store;
let floor;
let qc;
let buyerUser;
let buyerCo;
let product;

const post = (actor, path, body = {}, key = newKey()) => request(app).post(path).set('Authorization', bearer(actor)).set('Idempotency-Key', key).send(body);
const get = (actor, path) => request(app).get(path).set('Authorization', bearer(actor));
const availability = async (orderId, actor = store) => (await get(actor, `/api/finished-goods/availability?orderId=${orderId}`)).body.data.orders[0];

/** Order of `metres` m, confirmed, reserved by the floor, issued by the store, running on a loom. */
async function runningOrder(metres = 1200) {
  const lot = await YarnLot.create({ lotNumber: `GRN-DF-${Math.random().toString(36).slice(2, 7).toUpperCase()}`, material: 'COTTON', colour: 'Navy', supplierName: 'S', costPerKgPaise: 1, receivedAt: new Date(Date.now() - 86_400_000), receivedBy: admin._id, totalGrams: 5_000_000 });
  await InventoryTransaction.create({ type: 'RECEIPT', yarnLotId: lot._id, deltaTotalGrams: 5_000_000, deltaReservedGrams: 0, actorId: admin._id });
  const order = await createTestOrder({ buyer: buyerCo, product, createdBy: admin._id, status: 'CONFIRMED', quantityCm: metres * 100, requiredYarnGrams: metres * 170 });
  expect((await post(floor, `/api/orders/${order._id}/reserve`)).status).toBe(200);
  expect((await post(store, `/api/orders/${order._id}/issue`, { quantityKg: (metres * 170) / 1000 })).status).toBe(200);
  const loom = await Machine.create({ code: `W-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, name: 'Loom', type: 'WEAVING', ratedCmPerHour: 1500 });
  const run = (await post(floor, '/api/production-runs', { orderId: String(order._id), machineId: String(loom._id), targetMetres: metres })).body.data.run;
  expect((await post(floor, `/api/production-runs/${run.id}/start`)).status).toBe(200);
  return { order, run };
}
const recordRoll = async (run, metres) => (await post(floor, `/api/production-runs/${run.id}/rolls`, { lengthMetres: metres })).body.data.roll;
const inspect = (roll, result) => post(qc, `/api/rolls/${roll.id}/inspections`, result === 'PASS' ? { result, signature: SIGNED } : { result, defects: [{ type: 'HOLES', severity: 'CRITICAL' }], signature: SIGNED });
const goodsOf = async (orderId) => (await get(store, `/api/finished-goods?orderId=${orderId}&status=IN_STOCK`)).body.data.finishedGoods;

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
  qc = await createTestUser({ role: ROLES.QC_INSPECTOR });
  buyerCo = await createTestBuyer();
  buyerUser = await createTestUser({ role: ROLES.BUYER, buyerId: buyerCo._id });
  product = await createTestProduct();
});

afterEach(async () => {
  await clearCatalog();
  await clearInventory();
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('production → QC → finished goods → dispatch', () => {
  it('a fully produced, QC-passed order has its full quantity dispatchable, and only for that order', async () => {
    const { order, run } = await runningOrder(1200);
    const [a, b] = [await recordRoll(run, 600), await recordRoll(run, 600)];
    expect((await post(floor, `/api/production-runs/${run.id}/complete`)).body.data.run).toMatchObject({ status: 'COMPLETED', producedMetres: 1200 });
    // completed but not inspected: blocked, with the reason
    let avail = await availability(order._id);
    expect(avail).toMatchObject({ status: 'PRODUCTION_COMPLETED', dispatchableMetres: 0, reason: 'NOT_READY', awaitingQc: { rolls: 2, metres: 1200 } });
    expect(avail.message).toMatch(/awaiting quality inspection/);

    await inspect(a, 'PASS');
    // one roll passed, the other still in QC: in stock, but NOT dispatchable (prepare would be refused)
    avail = await availability(order._id);
    expect(avail).toMatchObject({ status: 'PRODUCTION_COMPLETED', inStock: { metres: 600 }, dispatchableMetres: 0, reason: 'NOT_READY' });
    expect(avail.message).toMatch(/600 m has passed QC/);
    expect((await post(store, '/api/dispatches', { orderId: String(order._id), finishedGoodIds: (await goodsOf(order._id)).map((g) => g.id) })).status).toBe(409);
    await inspect(b, 'PASS');
    const goods = await goodsOf(order._id);
    expect(goods.map((g) => g.lengthMetres)).toEqual([600, 600]);
    avail = await availability(order._id);
    expect(avail).toMatchObject({ status: 'READY_FOR_DISPATCH', dispatchableMetres: 1200, inStock: { rolls: 2, metres: 1200 }, reason: null });
    // the ready list (no orderId) uses the same rule
    const list = (await get(store, '/api/finished-goods/availability')).body.data.orders;
    expect(list.find((o) => o.orderId === String(order._id))).toMatchObject({ dispatchableMetres: 1200 });

    // another order cannot see or take this stock
    const { order: other } = await runningOrder(300);
    expect((await availability(other._id)).dispatchableMetres).toBe(0);
    const stolen = await post(store, '/api/dispatches', { orderId: String(other._id), finishedGoodIds: goods.map((g) => g.id) });
    expect(stolen.status).toBe(409);
  });

  it('the reported bug: after a dispatch is prepared, the order stays ready but says exactly where its stock is', async () => {
    const { order, run } = await runningOrder(1200);
    const rolls = [await recordRoll(run, 600), await recordRoll(run, 600)];
    await post(floor, `/api/production-runs/${run.id}/complete`);
    for (const r of rolls) await inspect(r, 'PASS');
    const ids = (await goodsOf(order._id)).map((g) => g.id);

    const key = newKey();
    const prepared = await post(store, '/api/dispatches', { orderId: String(order._id), finishedGoodIds: ids }, key);
    expect(prepared.status).toBe(201);
    // retrying the same prepare replays it: one dispatch, goods reserved once
    expect((await post(store, '/api/dispatches', { orderId: String(order._id), finishedGoodIds: ids }, key)).headers['idempotent-replayed']).toBe('true');
    expect(await Dispatch.countDocuments({ orderId: order._id })).toBe(1);

    const avail = await availability(order._id);
    expect(avail).toMatchObject({
      status: 'READY_FOR_DISPATCH',
      dispatchableMetres: 0,
      reason: 'RESERVED_IN_PREPARED_DISPATCH',
      reserved: { rolls: 2, metres: 1200, dispatches: [{ dispatchNumber: prepared.body.data.dispatch.dispatchNumber, metres: 1200 }] },
    });
    expect(avail.message).toContain(prepared.body.data.dispatch.dispatchNumber);
    // the same stock cannot be dispatched again, and an empty or zero dispatch is refused
    expect((await post(store, '/api/dispatches', { orderId: String(order._id), finishedGoodIds: ids })).body.error.code).toBe('FINISHED_GOODS_UNAVAILABLE');
    expect((await post(store, '/api/dispatches', { orderId: String(order._id), finishedGoodIds: [] })).status).toBe(400);

    // confirming dispatches it; cancelling instead would have put it back in stock
    await post(store, `/api/dispatches/${prepared.body.data.dispatch.id}/confirm`, { signature: SIGNED });
    expect(await availability(order._id)).toMatchObject({ status: 'DISPATCHED', reason: 'ALL_DISPATCHED', dispatched: { metres: 1200 } });
  });

  it('rejected rolls never become dispatchable stock; only passed metres are offered', async () => {
    const { order, run } = await runningOrder(1200);
    const [good, bad] = [await recordRoll(run, 700), await recordRoll(run, 500)];
    await post(floor, `/api/production-runs/${run.id}/complete`);
    await inspect(good, 'PASS');
    await inspect(bad, 'REJECT');
    expect(await availability(order._id)).toMatchObject({ dispatchableMetres: 700, rejected: { rolls: 1, metres: 500 } });
    expect(await FinishedGood.countDocuments({ rollId: bad.id })).toBe(0);
  });

  it('retrying production completion does not duplicate output or stock', async () => {
    const { order, run } = await runningOrder(600);
    const roll = await recordRoll(run, 600);
    const key = newKey();
    await post(floor, `/api/production-runs/${run.id}/complete`, {}, key);
    const again = await post(floor, `/api/production-runs/${run.id}/complete`, {}, key);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(await ProductionRun.findById(run.id).lean()).toMatchObject({ producedCm: 60_000, rollCount: 1 });
    await inspect(roll, 'PASS');
    await inspect(roll, 'PASS'); // a second inspection of the same roll is refused (409), no second good
    expect(await FinishedGood.countDocuments({ orderId: order._id })).toBe(1);
    expect(await Roll.countDocuments({ orderId: order._id })).toBe(1);
  });

  it('a failed dispatch transaction leaves no dispatch and the goods in stock', async () => {
    const { order, run } = await runningOrder(600);
    const roll = await recordRoll(run, 600);
    await post(floor, `/api/production-runs/${run.id}/complete`);
    await inspect(roll, 'PASS');
    const ids = (await goodsOf(order._id)).map((g) => g.id);
    const original = FinishedGood.updateMany;
    FinishedGood.updateMany = () => {
      throw new Error('simulated database failure');
    };
    try {
      expect((await post(store, '/api/dispatches', { orderId: String(order._id), finishedGoodIds: ids })).status).toBe(500);
    } finally {
      FinishedGood.updateMany = original;
    }
    expect(await Dispatch.countDocuments({ orderId: order._id })).toBe(0);
    expect(await availability(order._id)).toMatchObject({ dispatchableMetres: 600, reason: null });
    expect((await post(store, '/api/dispatches', { orderId: String(order._id), finishedGoodIds: ids })).status).toBe(201);
  });

  it('availability is for staff; buyers and unknown orders are refused', async () => {
    const { order } = await runningOrder(300);
    expect((await get(buyerUser, `/api/finished-goods/availability?orderId=${order._id}`)).status).toBe(403);
    expect((await get(store, '/api/finished-goods/availability?orderId=0123456789abcdef01234567')).status).toBe(404);
    expect((await get(store, '/api/finished-goods/availability?orderId=nope')).status).toBe(400);
  });
});
