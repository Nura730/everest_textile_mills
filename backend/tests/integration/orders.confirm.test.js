import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { IdempotencyRecord } from '../../src/models/IdempotencyRecord.js';
import { Order } from '../../src/models/Order.js';
import { User } from '../../src/models/User.js';
import { YarnLot } from '../../src/models/YarnLot.js';
import { dateStringToDate } from '../../src/utils/dates.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import {
  clearCatalog,
  createTestBuyer,
  createTestOrder,
  createTestProduct,
  daysFromToday,
  ensureCatalogCollections,
} from '../helpers/catalog.js';
import { clearInventory, ensureInventoryCollections, newKey } from '../helpers/inventory.js';

let app;
let admin;
let buyerCo;
let buyerUser;
let product;
let order; // 5,000 m of Navy Cotton: 850 kg of yarn (helpers/catalog.js)

let lotSeq = 0;
function addLot({ totalKg, reservedKg = 0, material = 'COTTON', colour = 'Navy' }) {
  lotSeq += 1;
  return YarnLot.create({
    lotNumber: `FEAS-${lotSeq}`,
    material,
    colour,
    supplierName: 'Sri Lakshmi Spinners',
    costPerKgPaise: 32000,
    receivedAt: new Date(),
    receivedBy: admin._id,
    totalGrams: totalKg * 1000,
    reservedGrams: reservedKg * 1000,
  });
}

const newOrder = (overrides = {}) => createTestOrder({ buyer: buyerCo, product, createdBy: admin._id, ...overrides });

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await ensureCatalogCollections();
  await ensureInventoryCollections();
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
  buyerCo = await createTestBuyer({ code: 'BUY-SRT', name: 'Surat Fabrics' });
  buyerUser = await createTestUser({ role: ROLES.BUYER, buyerId: buyerCo._id });
  product = await createTestProduct();
  order = await newOrder();
});

afterEach(async () => {
  await clearCatalog();
  await clearInventory();
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

const feasibility = (actor, orderId) =>
  request(app).get(`/api/orders/${orderId}/feasibility`).set('Authorization', bearer(actor));
const confirm = (actor, orderId, { key = newKey(), body = {} } = {}) =>
  request(app).post(`/api/orders/${orderId}/confirm`).set('Authorization', bearer(actor)).set('Idempotency-Key', key).send(body);
const stored = (id) => Order.findById(id).lean();

describe('GET /api/orders/:id/feasibility', () => {
  it('explains a feasible order in kg, with every check, and changes nothing', async () => {
    await addLot({ totalKg: 1200 });

    const res = await feasibility(admin, order._id);

    expect(res.status).toBe(200);
    expect(res.body.data.feasibility).toEqual({
      status: 'FEASIBLE',
      checks: [
        {
          code: 'MATERIAL',
          result: 'PASS',
          message: 'Needs 850 kg of COTTON Navy yarn; 1,200 kg is free (1,200 kg available in stock − 0 kg promised to other confirmed orders).',
        },
        { code: 'DEADLINE', result: 'PASS', message: expect.stringMatching(/^10 days left until the required-by date/) },
        { code: 'MACHINE_CAPACITY', result: 'NOT_ASSESSED', message: expect.any(String) },
      ],
      inputs: {
        requiredYarnKg: 850,
        stockTotalKg: 1200,
        stockReservedKg: 0,
        stockAvailableKg: 1200,
        committedKg: 0,
        freeKg: 1200,
        shortfallKg: 0,
        requiredBy: daysFromToday(10),
        assessedOn: daysFromToday(0),
        daysToDeadline: 10,
      },
      computedAt: expect.any(String),
    });
    expect((await stored(order._id)).status).toBe('ORDER_CREATED');
    expect(await AuditLog.countDocuments()).toBe(0);
  });

  it('counts only the order\'s own material and colour, and never reserved yarn', async () => {
    await addLot({ totalKg: 5000, colour: 'Red' });
    await addLot({ totalKg: 5000, material: 'POLYESTER' });
    await addLot({ totalKg: 1000, reservedKg: 400 });

    const { body } = await feasibility(admin, order._id);

    expect(body.data.feasibility.status).toBe('NOT_FEASIBLE');
    expect(body.data.feasibility.inputs).toMatchObject({ stockTotalKg: 1000, stockReservedKg: 400, freeKg: 600, shortfallKg: 250 });
  });

  it('is available to the floor manager and store keeper (planning roles)', async () => {
    for (const role of [ROLES.FLOOR_MANAGER, ROLES.STORE_KEEPER]) {
      expect((await feasibility(await createTestUser({ role }), order._id)).status).toBe(200);
    }
  });

  it('returns 404 for an unknown order and 400 for a malformed id', async () => {
    expect((await feasibility(admin, '64b7f0c2a1b2c3d4e5f60718')).status).toBe(404);
    expect((await feasibility(admin, 'nope')).status).toBe(400);
  });
});

describe('POST /api/orders/:id/confirm — feasible', () => {
  it('confirms, stores the feasibility snapshot and who confirmed, and audits it', async () => {
    await addLot({ totalKg: 1200 });

    const res = await confirm(admin, order._id);

    expect(res.status).toBe(200);
    const confirmed = res.body.data.order;
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', confirmedBy: String(admin._id) });
    expect(confirmed.feasibility).toMatchObject({ status: 'FEASIBLE', inputs: { requiredYarnKg: 850, freeKg: 1200 } });
    expect(confirmed.statusHistory.at(-1)).toMatchObject({ from: 'ORDER_CREATED', to: 'CONFIRMED', byRole: 'ADMIN', reason: null });

    const db = await stored(order._id);
    expect(db.feasibility.inputs).toMatchObject({ requiredYarnGrams: 850_000, freeGrams: 1_200_000 });

    const audit = await AuditLog.findOne({ action: 'ORDER_CONFIRMED' }).lean();
    expect(audit).toMatchObject({
      entityType: 'Order',
      before: { status: 'ORDER_CREATED' },
      after: { status: 'CONFIRMED', feasibility: { status: 'FEASIBLE' } },
    });
  });

  it('hides the factory\'s feasibility data from the buyer but shows the confirmation', async () => {
    await addLot({ totalKg: 1200 });
    await confirm(admin, order._id);

    const buyerView = (await request(app).get(`/api/orders/${order._id}`).set('Authorization', bearer(buyerUser))).body.data.order;
    const floorView = (
      await request(app).get(`/api/orders/${order._id}`).set('Authorization', bearer(await createTestUser({ role: ROLES.FLOOR_MANAGER })))
    ).body.data.order;

    expect(buyerView.status).toBe('CONFIRMED');
    expect(buyerView).not.toHaveProperty('feasibility');
    expect(buyerView).not.toHaveProperty('confirmedBy');
    expect(floorView.feasibility.status).toBe('FEASIBLE');
  });

  it('shows feasibility: null on staff views of an unconfirmed order', async () => {
    const res = await request(app).get(`/api/orders/${order._id}`).set('Authorization', bearer(admin));
    expect(res.body.data.order).toMatchObject({ feasibility: null, confirmedBy: null });
  });

  it('replays a retried confirmation instead of failing it', async () => {
    await addLot({ totalKg: 1200 });
    const key = newKey();
    await confirm(admin, order._id, { key });

    const retry = await confirm(admin, order._id, { key });

    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(await AuditLog.countDocuments({ action: 'ORDER_CONFIRMED' })).toBe(1);
  });

  it('returns 409 INVALID_STATE_TRANSITION when confirming twice with a new key', async () => {
    await addLot({ totalKg: 1200 });
    await confirm(admin, order._id);

    const res = await confirm(admin, order._id);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      details: { from: 'CONFIRMED', to: 'CONFIRMED', allowed: ['MATERIAL_RESERVED', 'CANCELLED'] },
    });
  });

  it.each(['CANCELLED', 'REJECTED'])('cannot confirm a %s order', async (status) => {
    await addLot({ totalKg: 1200 });
    const closed = await newOrder({ status });
    expect((await confirm(admin, closed._id)).body.error.code).toBe('INVALID_STATE_TRANSITION');
  });
});

describe('POST /api/orders/:id/confirm — not feasible', () => {
  it('refuses with 409 ORDER_NOT_FEASIBLE and the reasons, and changes nothing', async () => {
    await addLot({ totalKg: 600 });

    const res = await confirm(admin, order._id);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_NOT_FEASIBLE');
    expect(res.body.error.message).toMatch(/^This order cannot be confirmed\. Short by 250 kg/);
    expect(res.body.error.details.feasibility).toMatchObject({ status: 'NOT_FEASIBLE', inputs: { shortfallKg: 250 } });
    expect(await stored(order._id)).toMatchObject({ status: 'ORDER_CREATED', feasibility: null, confirmedBy: null });
    expect(await AuditLog.countDocuments()).toBe(0);
    expect(await IdempotencyRecord.countDocuments()).toBe(0);
  });

  it('lets the same key succeed once the yarn has arrived (failures are not stored)', async () => {
    await addLot({ totalKg: 600 });
    const key = newKey();
    expect((await confirm(admin, order._id, { key })).status).toBe(409);

    await addLot({ totalKg: 300 });
    const retry = await confirm(admin, order._id, { key });

    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
  });

  it('refuses when the required-by date has passed since the order was placed', async () => {
    await addLot({ totalKg: 1200 });
    const late = await newOrder({ requiredBy: dateStringToDate(daysFromToday(-1)) });

    const res = await confirm(admin, late._id);

    expect(res.status).toBe(409);
    const deadline = res.body.error.details.feasibility.checks.find((check) => check.code === 'DEADLINE');
    expect(deadline).toMatchObject({ result: 'FAIL', message: expect.stringContaining('has passed') });
  });
});

describe('yarn promised to confirmed orders', () => {
  it('cannot be promised twice: the second order sees the first as committed', async () => {
    await addLot({ totalKg: 1000 });
    const second = await newOrder();

    expect((await confirm(admin, order._id)).status).toBe(200);
    const res = await confirm(admin, second._id);

    expect(res.status).toBe(409);
    expect(res.body.error.details.feasibility.inputs).toMatchObject({ committedKg: 850, freeKg: 150 });
  });

  it('is freed again when a confirmed order is cancelled (by its buyer)', async () => {
    await addLot({ totalKg: 1000 });
    const second = await newOrder();
    await confirm(admin, order._id);

    const cancel = await request(app)
      .post(`/api/orders/${order._id}/cancel`)
      .set('Authorization', bearer(buyerUser))
      .set('Idempotency-Key', newKey())
      .send({ reason: 'Buyer changed plans' });

    expect(cancel.status).toBe(200);
    expect(cancel.body.data.order.statusHistory.at(-1)).toMatchObject({ from: 'CONFIRMED', to: 'CANCELLED' });
    expect((await confirm(admin, second._id)).status).toBe(200);
  });

  it('lets exactly one of two concurrent confirmations for the same yarn win', async () => {
    await addLot({ totalKg: 1000 });
    const second = await newOrder();

    const results = await Promise.all([confirm(admin, order._id), confirm(admin, second._id)]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    expect(results.find((res) => res.status === 409).body.error.code).toBe('ORDER_NOT_FEASIBLE');
    expect(await Order.countDocuments({ status: 'CONFIRMED' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'ORDER_CONFIRMED' })).toBe(1);
  });
});

describe('POST /api/orders/:id/confirm — request rules', () => {
  it('requires an Idempotency-Key', async () => {
    const res = await request(app).post(`/api/orders/${order._id}/confirm`).set('Authorization', bearer(admin)).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].location).toBe('headers');
  });

  it('accepts no body at all', async () => {
    await addLot({ totalKg: 1200 });
    const res = await request(app).post(`/api/orders/${order._id}/confirm`).set('Authorization', bearer(admin)).set('Idempotency-Key', newKey());
    expect(res.status).toBe(200);
  });

  it('rejects any field in the body (no forced verdicts)', async () => {
    const res = await confirm(admin, order._id, { body: { force: true } });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown order', async () => {
    expect((await confirm(admin, '64b7f0c2a1b2c3d4e5f60718')).status).toBe(404);
  });
});
