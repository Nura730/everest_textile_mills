import { jest } from '@jest/globals';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { Counter } from '../../src/models/Counter.js';
import { IdempotencyRecord } from '../../src/models/IdempotencyRecord.js';
import { Order } from '../../src/models/Order.js';
import { Product } from '../../src/models/Product.js';
import { User } from '../../src/models/User.js';
import { todayInIndia } from '../../src/utils/dates.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import {
  clearCatalog,
  createTestBuyer,
  createTestProduct,
  daysFromToday,
  ensureCatalogCollections,
  maxDeadline,
} from '../helpers/catalog.js';
import { newKey } from '../helpers/inventory.js';

let app;
let admin;
let buyerCo;
let buyerUser;
let product;
const YEAR = todayInIndia().slice(0, 4);

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await ensureCatalogCollections();
  await Promise.all([AuditLog.createCollection(), IdempotencyRecord.init()]);
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
  buyerCo = await createTestBuyer({ code: 'BUY-SRT', name: 'Surat Fabrics' });
  buyerUser = await createTestUser({ role: ROLES.BUYER, buyerId: buyerCo._id });
  product = await createTestProduct();
});

afterEach(async () => {
  await clearCatalog();
  await Promise.all([AuditLog.collection.deleteMany({}), IdempotencyRecord.deleteMany({}), User.deleteMany({})]);
});

afterAll(async () => {
  await disconnectDatabase();
});

const orderBody = (overrides = {}) => ({
  productId: String(product._id),
  quantityMetres: 5000,
  requiredBy: daysFromToday(30),
  ...overrides,
});

function createOrder(actor, body, key = newKey()) {
  let req = request(app).post('/api/orders').send(body);
  if (actor) req = req.set('Authorization', bearer(actor));
  if (key) req = req.set('Idempotency-Key', key);
  return req;
}

const counts = async () => ({
  orders: await Order.countDocuments(),
  audits: await AuditLog.countDocuments({ action: 'ORDER_CREATED' }),
  keys: await IdempotencyRecord.countDocuments(),
});

describe('POST /api/orders — buyer places an order', () => {
  it('creates the order for the buyer\'s own company with derived figures', async () => {
    const res = await createOrder(buyerUser, orderBody({ quantityMetres: 5000, buyerNotes: 'Pack in 100 m rolls' }));

    expect(res.status).toBe(201);
    expect(res.body.data.order).toEqual({
      id: expect.any(String),
      orderNumber: `ORD-${YEAR}-0001`,
      status: 'ORDER_CREATED',
      buyer: { id: String(buyerCo._id), code: 'BUY-SRT', name: 'Surat Fabrics' },
      product: { id: String(product._id), code: product.code, name: 'Navy Cotton Plain', material: 'COTTON', colour: 'Navy' },
      quantityMetres: 5000,
      requiredBy: daysFromToday(30),
      buyerNotes: 'Pack in 100 m rolls',
      pricePerMetrePaise: 18000,
      orderValuePaise: 90_000_000,
      statusHistory: [{ from: null, to: 'ORDER_CREATED', at: expect.any(String), byRole: 'BUYER', reason: null }],
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    // Internal planning data is stored but not shown to the buyer.
    const stored = await Order.findOne().lean();
    expect(stored).toMatchObject({ quantityCm: 500_000, requiredYarnGrams: 850_000, createdByRole: 'BUYER' });
    expect(String(stored.createdBy)).toBe(String(buyerUser._id));
  });

  it('snapshots the product: later catalog changes do not alter the order', async () => {
    const res = await createOrder(buyerUser, orderBody());
    await Product.updateOne({ _id: product._id }, { defaultPricePerMetrePaise: 99999, yarnGramsPerMetre: 999 });

    const stored = await Order.findById(res.body.data.order.id).lean();
    expect(stored.product).toMatchObject({ pricePerMetrePaise: 18000, yarnGramsPerMetre: 170 });
  });

  it('writes an ORDER_CREATED audit entry linked to the order', async () => {
    const res = await createOrder(buyerUser, orderBody());
    const audit = await AuditLog.findOne({ action: 'ORDER_CREATED' }).lean();

    expect(String(audit.orderId)).toBe(res.body.data.order.id);
    expect(audit.after).toMatchObject({ orderNumber: `ORD-${YEAR}-0001`, requiredYarnGrams: 850_000 });
  });

  it('numbers orders sequentially', async () => {
    const first = await createOrder(buyerUser, orderBody());
    const second = await createOrder(buyerUser, orderBody());
    expect([first.body.data.order.orderNumber, second.body.data.order.orderNumber]).toEqual([
      `ORD-${YEAR}-0001`,
      `ORD-${YEAR}-0002`,
    ]);
  });

  it('gives concurrent orders distinct numbers', async () => {
    const results = await Promise.all([1, 2, 3, 4].map(() => createOrder(buyerUser, orderBody())));
    const numbers = results.map((res) => res.body.data.order.orderNumber).sort();

    expect(results.every((res) => res.status === 201)).toBe(true);
    expect(new Set(numbers).size).toBe(4);
    expect(numbers).toEqual([1, 2, 3, 4].map((n) => `ORD-${YEAR}-000${n}`));
  });
});

describe('POST /api/orders — admin orders on a buyer\'s behalf', () => {
  it('creates an order for the named buyer and shows the yarn requirement to the admin', async () => {
    const res = await createOrder(admin, orderBody({ buyerId: String(buyerCo._id) }));

    expect(res.status).toBe(201);
    expect(res.body.data.order).toMatchObject({ buyer: { code: 'BUY-SRT' }, requiredYarnKg: 850, createdBy: String(admin._id) });
  });

  it('requires buyerId from an admin', async () => {
    const res = await createOrder(admin, orderBody());
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'buyerId' })]));
  });

  it('returns 400 for a buyer that does not exist', async () => {
    const res = await createOrder(admin, orderBody({ buyerId: '64b7f0c2a1b2c3d4e5f60718' }));
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ location: 'body', path: 'buyerId', message: 'does not exist' }]);
  });

  it('returns 409 BUYER_INACTIVE for an inactive buyer company', async () => {
    const inactive = await createTestBuyer({ isActive: false });
    const res = await createOrder(admin, orderBody({ buyerId: String(inactive._id) }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BUYER_INACTIVE');
  });
});

describe('POST /api/orders — validation and mass assignment', () => {
  it.each([
    ['zero quantity', { quantityMetres: 0 }, 'quantityMetres'],
    ['negative quantity', { quantityMetres: -10 }, 'quantityMetres'],
    ['three decimals', { quantityMetres: 10.125 }, 'quantityMetres'],
    ['over 1,000,000 m', { quantityMetres: 1_000_000.01 }, 'quantityMetres'],
    ['a string quantity', { quantityMetres: '5000' }, 'quantityMetres'],
    ['a deadline of today', { requiredBy: todayInIndia() }, 'requiredBy'],
    ['a past deadline', { requiredBy: '2020-01-01' }, 'requiredBy'],
    ['a deadline over 2 years away', { requiredBy: daysFromToday(800) }, 'requiredBy'],
    ['a datetime instead of a date', { requiredBy: `${daysFromToday(5)}T10:00:00Z` }, 'requiredBy'],
    ['a malformed product id', { productId: 'abc' }, 'productId'],
  ])('returns 400 for %s', async (_label, overrides, path) => {
    const res = await createOrder(buyerUser, orderBody(overrides));

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
    expect(await counts()).toEqual({ orders: 0, audits: 0, keys: 0 });
  });

  it('accepts the boundaries: tomorrow, 2 years ahead, 0.01 m and 1,000,000 m', async () => {
    for (const overrides of [
      { requiredBy: daysFromToday(1) },
      { requiredBy: maxDeadline() },
      { quantityMetres: 0.01 },
      { quantityMetres: 1_000_000 },
    ]) {
      expect((await createOrder(buyerUser, orderBody(overrides))).status).toBe(201);
    }
  });

  it.each([
    ['status', 'CONFIRMED'],
    ['orderNumber', 'ORD-1999-0001'],
    ['pricePerMetrePaise', 1],
    ['orderValuePaise', 1],
    ['requiredYarnGrams', 1],
    ['createdBy', '64b7f0c2a1b2c3d4e5f60718'],
    ['buyerId', '64b7f0c2a1b2c3d4e5f60718'],
  ])('rejects the protected field %s from a buyer (400, nothing written)', async (field, value) => {
    const res = await createOrder(buyerUser, { ...orderBody(), [field]: value });

    expect(res.status).toBe(400);
    expect(await counts()).toEqual({ orders: 0, audits: 0, keys: 0 });
  });

  it('returns 400 for a product that does not exist', async () => {
    const res = await createOrder(buyerUser, orderBody({ productId: '64b7f0c2a1b2c3d4e5f60718' }));
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ location: 'body', path: 'productId', message: 'does not exist' }]);
  });

  it('returns 409 PRODUCT_INACTIVE for a retired product', async () => {
    const retired = await createTestProduct({ isActive: false });
    const res = await createOrder(buyerUser, orderBody({ productId: String(retired._id) }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRODUCT_INACTIVE');
  });
});

describe('POST /api/orders — permissions', () => {
  it('returns 401 without a token', async () => {
    expect((await createOrder(null, orderBody())).status).toBe(401);
  });

  it.each([ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR])('returns 403 for %s', async (role) => {
    const actor = await createTestUser({ role });
    expect((await createOrder(actor, orderBody())).status).toBe(403);
  });

  it('returns 403 for a buyer account not linked to a company', async () => {
    const unlinked = await createTestUser({ role: ROLES.BUYER });
    const res = await createOrder(unlinked, orderBody());

    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('Your account is not linked to a buyer company');
  });
});

describe('POST /api/orders — idempotency, duplicates and failures', () => {
  it('requires an Idempotency-Key', async () => {
    expect((await createOrder(buyerUser, orderBody(), null)).status).toBe(400);
  });

  it('creates one order when a double-click sends the same request twice', async () => {
    const key = newKey();
    const body = orderBody();
    const [a, b] = await Promise.all([createOrder(buyerUser, body, key), createOrder(buyerUser, body, key)]);

    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.data.order.orderNumber).toBe(b.body.data.order.orderNumber);
    expect(await counts()).toEqual({ orders: 1, audits: 1, keys: 1 });
  });

  it('returns 409 DUPLICATE_RESOURCE if an order number is already taken, and writes nothing', async () => {
    await createOrder(buyerUser, orderBody());
    // Simulate a counter that went backwards (e.g. restored from an old backup).
    await Counter.updateOne({ _id: `order:${YEAR}` }, { seq: 0 });

    const res = await createOrder(buyerUser, orderBody());

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'DUPLICATE_RESOURCE', details: { fields: ['orderNumber'] } });
    expect(await counts()).toEqual({ orders: 1, audits: 1, keys: 1 });
    expect((await Counter.findById(`order:${YEAR}`).lean()).seq).toBe(0); // the increment rolled back
  });

  it('writes nothing and consumes no order number when the database fails midway', async () => {
    const key = newKey();
    const body = orderBody();
    const auditSpy = jest.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('simulated write failure'));

    const failed = await createOrder(buyerUser, body, key);
    expect(failed.status).toBe(500);
    expect(failed.body.error.code).toBe('INTERNAL_ERROR');
    expect(await counts()).toEqual({ orders: 0, audits: 0, keys: 0 });
    expect(await Counter.findById(`order:${YEAR}`).lean()).toBeNull();

    auditSpy.mockRestore();
    const retry = await createOrder(buyerUser, body, key);
    expect(retry.status).toBe(201);
    expect(retry.body.data.order.orderNumber).toBe(`ORD-${YEAR}-0001`);
  });
});
