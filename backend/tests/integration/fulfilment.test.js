import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { FinishedGood, Invoice } from '../../src/models/Fulfilment.js';
import { Machine } from '../../src/models/Machine.js';
import { Order } from '../../src/models/Order.js';
import { ProductionRun } from '../../src/models/ProductionRun.js';
import { Roll } from '../../src/models/Roll.js';
import { Signature } from '../../src/models/Signature.js';
import { User } from '../../src/models/User.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { clearCatalog, createTestBuyer, createTestOrder, createTestProduct, ensureCatalogCollections } from '../helpers/catalog.js';
import { clearInventory, ensureInventoryCollections, newKey } from '../helpers/inventory.js';
import { SIGNED } from '../helpers/signature.js';

let app;
let admin;
let qc;
let store;
let buyerUser;
let otherBuyer;
let order; // 5,000 m at ₹180/m; PRODUCTION_COMPLETED
let run;
let machine;
let product;
let buyerCo;
let seq = 0;

async function roll(lengthCm, overrides = {}) {
  seq += 1;
  return Roll.create({
    rollNumber: `ROLL-F-${String(seq).padStart(5, '0')}`, orderId: order._id, orderNumber: order.orderNumber, runId: run._id, runNumber: run.runNumber,
    machineId: machine._id, machineCode: machine.code, lengthCm, producedBy: admin._id, ...overrides,
  });
}

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await ensureCatalogCollections();
  await ensureInventoryCollections();
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
  qc = await createTestUser({ role: ROLES.QC_INSPECTOR });
  store = await createTestUser({ role: ROLES.STORE_KEEPER, name: 'Ravi Store' });
  buyerCo = await createTestBuyer({ address: 'Ring Road, Surat' });
  buyerUser = await createTestUser({ role: ROLES.BUYER, buyerId: buyerCo._id });
  otherBuyer = await createTestUser({ role: ROLES.BUYER, buyerId: (await createTestBuyer())._id });
  product = await createTestProduct();
  order = await createTestOrder({ buyer: buyerCo, product, createdBy: admin._id, status: 'PRODUCTION_COMPLETED' });
  machine = await Machine.create({ code: 'W-01', name: 'Loom', type: 'WEAVING', ratedCmPerHour: 1500 });
  run = await ProductionRun.create({ runNumber: 'RUN-F-1', orderId: order._id, orderNumber: order.orderNumber, machineId: machine._id, machineCode: 'W-01', targetCm: 500_000, producedCm: 500_000, rollCount: 2, status: 'COMPLETED', supervisorId: admin._id });
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
const get = (actor, path) => request(app).get(path).set('Authorization', bearer(actor));
const pass = (r) => post(qc, `/api/rolls/${r._id}/inspections`, { result: 'PASS', signature: SIGNED });
const reject = (r) => post(qc, `/api/rolls/${r._id}/inspections`, { result: 'REJECT', defects: [{ type: 'HOLES', severity: 'CRITICAL' }], signature: SIGNED });
const orderStatus = async () => (await Order.findById(order._id).lean()).status;
const fgOf = async (r) => FinishedGood.findOne({ rollId: r._id }).lean();

describe('finished goods and readiness', () => {
  it('a QC pass creates a finished good; the order is ready only when no roll is left to inspect', async () => {
    const a = await roll(250_000);
    const b = await roll(250_000);
    const first = await pass(a);
    expect(first.body.data).toMatchObject({ finishedGood: { rollNumber: a.rollNumber, status: 'IN_STOCK', location: 'FG store' }, orderStatus: 'PRODUCTION_COMPLETED' });
    expect((await pass(b)).body.data.orderStatus).toBe('READY_FOR_DISPATCH');
    expect(await AuditLog.countDocuments({ action: 'FINISHED_GOOD_CREATED' })).toBe(2);
    expect(await AuditLog.countDocuments({ action: 'ORDER_READY_FOR_DISPATCH' })).toBe(1);
  });

  it('a rejected roll never becomes stock, but a reject can be what makes the order ready', async () => {
    const good = await roll(400_000);
    const bad = await roll(100_000);
    await pass(good);
    const res = await reject(bad);
    expect(res.body.data.orderStatus).toBe('READY_FOR_DISPATCH');
    expect(await fgOf(bad)).toBeNull();
  });

  it('a roll in rework holds the order back', async () => {
    const a = await roll(250_000);
    const b = await roll(250_000);
    await pass(a);
    await post(qc, `/api/rolls/${b._id}/inspections`, { result: 'REWORK', defects: [{ type: 'STAINS', severity: 'MINOR' }], signature: SIGNED });
    expect(await orderStatus()).toBe('PRODUCTION_COMPLETED');
  });

  it('an order still in production is not ready even if its rolls have passed', async () => {
    await Order.updateOne({ _id: order._id }, { $set: { status: 'IN_PRODUCTION' } });
    await pass(await roll(500_000));
    expect(await orderStatus()).toBe('IN_PRODUCTION');
  });

  it('lists finished goods and lets the store move them; a dispatched good cannot move', async () => {
    const a = await roll(500_000);
    await pass(a);
    const fg = await fgOf(a);
    expect((await get(store, `/api/finished-goods?orderId=${order._id}&status=IN_STOCK`)).body.meta.total).toBe(1);
    const moved = await request(app).patch(`/api/finished-goods/${fg._id}/location`).set('Authorization', bearer(store)).set('Idempotency-Key', newKey()).send({ location: 'Rack B-4' });
    expect(moved.body.data.finishedGood.location).toBe('Rack B-4');
    await FinishedGood.updateOne({ _id: fg._id }, { $set: { status: 'DISPATCHED' } });
    expect((await request(app).patch(`/api/finished-goods/${fg._id}/location`).set('Authorization', bearer(store)).set('Idempotency-Key', newKey()).send({ location: 'Rack C' })).status).toBe(409);
    expect((await get(buyerUser, '/api/finished-goods')).status).toBe(403);
  });
});

describe('dispatch', () => {
  let a;
  let b;
  beforeEach(async () => {
    a = await roll(300_000);
    b = await roll(200_000);
    await pass(a);
    await pass(b); // order READY_FOR_DISPATCH
  });
  const fgIds = async (...rolls) => Promise.all(rolls.map(async (r) => String((await fgOf(r))._id)));
  const prepare = async (rolls, actor = store) => post(actor, '/api/dispatches', { orderId: String(order._id), finishedGoodIds: await fgIds(...rolls), vehicleNumber: 'TN 39 AB 1234' });

  it('prepares, then a signed confirmation dispatches the goods and the order', async () => {
    const prepared = await prepare([a, b]);
    expect(prepared.status).toBe(201);
    expect(prepared.body.data.dispatch).toMatchObject({ dispatchNumber: expect.stringMatching(/^DSP-\d{4}-0001$/), status: 'PREPARED', rollCount: 2, totalMetres: 5000 });
    expect((await fgOf(a)).status).toBe('RESERVED_FOR_DISPATCH');

    const id = prepared.body.data.dispatch.id;
    const unsigned = await post(store, `/api/dispatches/${id}/confirm`, {});
    expect(unsigned.body.error).toMatchObject({ code: 'SIGNATURE_REQUIRED', details: { statement: expect.stringContaining('have been dispatched') } });
    const confirmed = await post(store, `/api/dispatches/${id}/confirm`, { signature: SIGNED });
    expect(confirmed.body.data).toMatchObject({ dispatch: { status: 'CONFIRMED', signed: true }, orderStatus: 'DISPATCHED' });
    expect((await fgOf(a)).status).toBe('DISPATCHED');
    expect(await Signature.findOne({ entityType: 'DISPATCH' }).lean()).toMatchObject({ signerName: 'Ravi Store', signerRole: 'STORE_KEEPER' });
  });

  it('a partial dispatch leaves the order ready for the rest', async () => {
    const prepared = await prepare([a]);
    await post(store, `/api/dispatches/${prepared.body.data.dispatch.id}/confirm`, { signature: SIGNED });
    expect(await orderStatus()).toBe('READY_FOR_DISPATCH');
  });

  it('prevents double dispatch, rejected or foreign rolls, and duplicates', async () => {
    await prepare([a]);
    expect((await prepare([a])).body.error).toMatchObject({ code: 'FINISHED_GOODS_UNAVAILABLE' });
    const ids = await fgIds(b);
    expect((await post(store, '/api/dispatches', { orderId: String(order._id), finishedGoodIds: [ids[0], ids[0]] })).status).toBe(400);
    const otherOrder = await createTestOrder({ buyer: buyerCo, product, createdBy: admin._id, status: 'READY_FOR_DISPATCH' });
    expect((await post(store, '/api/dispatches', { orderId: String(otherOrder._id), finishedGoodIds: ids })).body.error.code).toBe('FINISHED_GOODS_UNAVAILABLE');
  });

  it('two dispatches racing for the same roll: exactly one gets it', async () => {
    const ids = await fgIds(a);
    const results = await Promise.all([
      post(store, '/api/dispatches', { orderId: String(order._id), finishedGoodIds: ids }),
      post(admin, '/api/dispatches', { orderId: String(order._id), finishedGoodIds: ids }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('cancelling a prepared dispatch puts the goods back; a confirmed one cannot be cancelled', async () => {
    const first = await prepare([a]);
    expect((await post(store, `/api/dispatches/${first.body.data.dispatch.id}/cancel`, { reason: 'Truck did not arrive' })).body.data.dispatch.status).toBe('CANCELLED');
    expect((await fgOf(a)).status).toBe('IN_STOCK');
    const second = await prepare([a]);
    await post(store, `/api/dispatches/${second.body.data.dispatch.id}/confirm`, { signature: SIGNED });
    expect((await post(store, `/api/dispatches/${second.body.data.dispatch.id}/cancel`, { reason: 'Too late now' })).status).toBe(409);
  });

  it('only the store (and admin) dispatch; buyers see only their own dispatches', async () => {
    expect((await prepare([a], await createTestUser({ role: ROLES.FLOOR_MANAGER }))).status).toBe(403);
    await prepare([a]);
    expect((await get(buyerUser, '/api/dispatches')).body.meta.total).toBe(1);
    expect((await get(otherBuyer, '/api/dispatches')).body.meta.total).toBe(0);
  });

  describe('delivery after dispatch', () => {
    let dispatchId;
    const deliver = (actor, action, body = {}, key) => post(actor, `/api/dispatches/${dispatchId}/delivery/${action}`, body, key);
    beforeEach(async () => {
      dispatchId = (await prepare([a, b])).body.data.dispatch.id;
    });

    it('nothing before the dispatch is confirmed; then IN_TRANSIT and no invoice until verified', async () => {
      expect((await deliver(buyerUser, 'confirm')).body.error.code).toBe('INVALID_STATE_TRANSITION');
      const confirmed = await post(store, `/api/dispatches/${dispatchId}/confirm`, { signature: SIGNED });
      expect(confirmed.body.data.dispatch.delivery).toMatchObject({ status: 'IN_TRANSIT', delivered: null, verified: null });
      const early = await post(admin, `/api/dispatches/${dispatchId}/invoice`);
      expect(early.status).toBe(409);
      expect(early.body.error).toMatchObject({ code: 'DELIVERY_NOT_VERIFIED', details: { deliveryStatus: 'IN_TRANSIT' } });
      expect(await Invoice.countDocuments()).toBe(0);
    });

    it('buyer confirms (own dispatch only, once), admin verifies, invoice issued once: actors and times recorded', async () => {
      await post(store, `/api/dispatches/${dispatchId}/confirm`, { signature: SIGNED });
      expect((await deliver(otherBuyer, 'confirm')).status).toBe(404);
      for (const actor of [store, qc]) expect((await deliver(actor, 'confirm')).status).toBe(403);
      const key = newKey();
      const done = await deliver(buyerUser, 'confirm', { note: 'All 2 rolls received in good order' }, key);
      expect(done.body.data.dispatch.delivery).toMatchObject({ status: 'DELIVERED', delivered: { byRole: 'BUYER', note: 'All 2 rolls received in good order' }, confirmedOnBuyersBehalf: false });
      expect((await deliver(buyerUser, 'confirm', { note: 'All 2 rolls received in good order' }, key)).headers['idempotent-replayed']).toBe('true');
      expect((await deliver(buyerUser, 'confirm')).body.error.code).toBe('INVALID_STATE_TRANSITION'); // a second confirmation
      expect((await post(admin, `/api/dispatches/${dispatchId}/invoice`)).body.error.details.deliveryStatus).toBe('DELIVERED');
      expect((await deliver(buyerUser, 'verify')).status).toBe(403);
      const verified = await deliver(admin, 'verify', { note: 'Checked against the signed delivery note' });
      expect(verified.body.data.dispatch.delivery).toMatchObject({ status: 'VERIFIED', verified: { byRole: 'ADMIN' } });
      expect((await post(admin, `/api/dispatches/${dispatchId}/invoice`)).status).toBe(201);
      expect((await post(admin, `/api/dispatches/${dispatchId}/invoice`)).body.error.code).toBe('DUPLICATE_RESOURCE');
      expect(await Invoice.countDocuments()).toBe(1);
      expect(await AuditLog.countDocuments({ action: { $in: ['DELIVERY_CONFIRMED', 'DELIVERY_VERIFIED'] } })).toBe(2);
      const buyerView = (await get(buyerUser, `/api/dispatches/${dispatchId}`)).body.data.dispatch.delivery;
      expect(buyerView.delivered.at).toBeTruthy();
      expect(buyerView.verified.at).toBeTruthy();
    });

    it('a discrepancy blocks the invoice until the admin resolves it with a note', async () => {
      await post(store, `/api/dispatches/${dispatchId}/confirm`, { signature: SIGNED });
      expect((await deliver(buyerUser, 'discrepancy', {})).status).toBe(400); // description required
      const reported = await deliver(buyerUser, 'discrepancy', { note: 'Roll B arrived with a torn wrap' });
      expect(reported.body.data.dispatch.delivery).toMatchObject({ status: 'DISCREPANCY', discrepancy: { byRole: 'BUYER', note: 'Roll B arrived with a torn wrap' } });
      expect((await deliver(buyerUser, 'confirm')).body.error.code).toBe('INVALID_STATE_TRANSITION');
      expect((await post(admin, `/api/dispatches/${dispatchId}/invoice`)).body.error.details.deliveryStatus).toBe('DISCREPANCY');
      expect((await deliver(admin, 'verify', {})).body.error.code).toBe('VALIDATION_ERROR'); // resolution needed
      expect((await deliver(admin, 'verify', { note: 'Wrap only; fabric inspected and accepted by buyer' })).body.data.dispatch.delivery.status).toBe('VERIFIED');
      expect((await post(admin, `/api/dispatches/${dispatchId}/invoice`)).status).toBe(201);
    });

    it('the admin can confirm for the buyer only with a proof note, and it is marked as such', async () => {
      await post(store, `/api/dispatches/${dispatchId}/confirm`, { signature: SIGNED });
      expect((await deliver(admin, 'confirm', {})).body.error.code).toBe('VALIDATION_ERROR');
      // the buyer is told; the timeline shows the consignment in transit
      expect((await get(buyerUser, '/api/summary/attention')).body.data.alerts.map((x) => x.key)).toContain('buyer-confirm-delivery');
      expect((await get(buyerUser, `/api/orders/${order._id}/timeline`)).body.data.timeline.deliveries).toEqual([expect.objectContaining({ status: 'IN_TRANSIT', metres: 5000, invoiced: false })]);
      const done = await deliver(admin, 'confirm', { note: 'Delivery note signed by buyer stores, ref DN-551' });
      expect((await get(admin, '/api/summary/attention')).body.data.alerts.map((x) => x.key)).toContain('delivery-to-verify');
      expect(done.body.data.dispatch.delivery).toMatchObject({ status: 'DELIVERED', confirmedOnBuyersBehalf: true, delivered: { byRole: 'ADMIN' } });
    });
  });

  describe('invoice', () => {
    let dispatchId;
    beforeEach(async () => {
      const prepared = await prepare([a, b]);
      dispatchId = prepared.body.data.dispatch.id;
      await post(store, `/api/dispatches/${dispatchId}/confirm`, { signature: SIGNED });
      // delivery: the buyer confirms receipt, the admin verifies; only then can it be invoiced
      expect((await post(buyerUser, `/api/dispatches/${dispatchId}/delivery/confirm`, {})).status).toBe(200);
      expect((await post(admin, `/api/dispatches/${dispatchId}/delivery/verify`, {})).status).toBe(200);
    });

    it('issues one invoice per dispatch at the order\'s price with 5% GST; the order becomes INVOICED', async () => {
      const res = await post(admin, `/api/dispatches/${dispatchId}/invoice`);
      expect(res.status).toBe(201);
      // 3,000 m + 2,000 m at ₹180 = ₹9,00,000; GST 5% = ₹45,000
      expect(res.body.data.invoice).toMatchObject({
        invoiceNumber: expect.stringMatching(/^INV-\d{4}-0001$/), subtotalPaise: 90_000_000, taxRateBasisPoints: 500, taxPaise: 4_500_000, totalPaise: 94_500_000,
        buyer: { address: 'Ring Road, Surat' },
      });
      expect(res.body.data.order.status).toBe('INVOICED');
      expect((await post(admin, `/api/dispatches/${dispatchId}/invoice`)).body.error.code).toBe('DUPLICATE_RESOURCE');
      // an invoiced order is complete: every timeline stage done, none left "current"
      const timeline = (await get(buyerUser, `/api/orders/${order._id}/timeline`)).body.data.timeline;
      expect(timeline.completed).toBe(true);
      expect(timeline.stages.every((stage) => stage.state === 'done')).toBe(true);
    });

    it('only the admin issues; the owning buyer can read the invoice, another buyer cannot', async () => {
      expect((await post(store, `/api/dispatches/${dispatchId}/invoice`)).status).toBe(403);
      const invoice = (await post(admin, `/api/dispatches/${dispatchId}/invoice`)).body.data.invoice;
      expect((await get(buyerUser, `/api/invoices/${invoice.id}`)).body.data.invoice.totalPaise).toBe(94_500_000);
      expect((await get(otherBuyer, `/api/invoices/${invoice.id}`)).status).toBe(404);
      expect((await get(store, '/api/invoices')).status).toBe(403);
    });
  });
});
