import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { IdempotencyRecord } from '../../src/models/IdempotencyRecord.js';
import { Order } from '../../src/models/Order.js';
import { User } from '../../src/models/User.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { clearCatalog, createTestBuyer, createTestOrder, createTestProduct, ensureCatalogCollections } from '../helpers/catalog.js';
import { newKey } from '../helpers/inventory.js';

let app;
let admin;
let product;
let surat;
let tiruppur;
let suratBuyer;
let tiruppurBuyer;
let suratOrder;
let tiruppurOrder;

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await ensureCatalogCollections();
  await Promise.all([AuditLog.createCollection(), IdempotencyRecord.init()]);
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
  product = await createTestProduct();
  surat = await createTestBuyer({ code: 'BUY-SRT', name: 'Surat Fabrics' });
  tiruppur = await createTestBuyer({ code: 'BUY-TPR', name: 'Tiruppur Knits' });
  suratBuyer = await createTestUser({ role: ROLES.BUYER, buyerId: surat._id });
  tiruppurBuyer = await createTestUser({ role: ROLES.BUYER, buyerId: tiruppur._id });
  suratOrder = await createTestOrder({ buyer: surat, product, createdBy: admin._id });
  tiruppurOrder = await createTestOrder({ buyer: tiruppur, product, createdBy: admin._id });
});

afterEach(async () => {
  await clearCatalog();
  await Promise.all([AuditLog.collection.deleteMany({}), IdempotencyRecord.deleteMany({}), User.deleteMany({})]);
});

afterAll(async () => {
  await disconnectDatabase();
});

const get = (actor, path) => request(app).get(path).set('Authorization', bearer(actor));
const act = (actor, orderId, action, body = { reason: 'Buyer changed plans' }, key = newKey()) =>
  request(app).post(`/api/orders/${orderId}/${action}`).set('Authorization', bearer(actor)).set('Idempotency-Key', key).send(body);

describe('GET /api/orders — ownership', () => {
  it('shows a buyer only their own company\'s orders', async () => {
    const res = await get(suratBuyer, '/api/orders');

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data.orders[0].id).toBe(String(suratOrder._id));
  });

  it('ignores a buyerId filter from a buyer (cannot list another company)', async () => {
    const res = await get(suratBuyer, `/api/orders?buyerId=${tiruppur._id}`);
    expect(res.body.data.orders.map((order) => order.id)).toEqual([String(suratOrder._id)]);
  });

  it('shows nothing to a buyer account not linked to a company (fails closed)', async () => {
    const unlinked = await createTestUser({ role: ROLES.BUYER });
    const res = await get(unlinked, '/api/orders');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ data: { orders: [] }, meta: { total: 0 } });
  });

  it.each([ROLES.ADMIN, ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR])(
    'shows all orders to %s, filterable by buyer and status',
    async (role) => {
      const actor = role === ROLES.ADMIN ? admin : await createTestUser({ role });

      expect((await get(actor, '/api/orders')).body.meta.total).toBe(2);
      expect((await get(actor, `/api/orders?buyerId=${tiruppur._id}`)).body.meta.total).toBe(1);
      expect((await get(actor, '/api/orders?status=CANCELLED')).body.meta.total).toBe(0);
    },
  );

  it.each(['status=SHIPPED', 'buyerId=abc', 'limit=500'])('returns 400 for ?%s', async (query) => {
    expect((await get(admin, `/api/orders?${query}`)).status).toBe(400);
  });
});

describe('GET /api/orders/:id — ownership and field visibility', () => {
  it('lets a buyer read their own order, without internal fields', async () => {
    const res = await get(suratBuyer, `/api/orders/${suratOrder._id}`);
    const order = res.body.data.order;

    expect(res.status).toBe(200);
    expect(order).toMatchObject({ orderNumber: suratOrder.orderNumber, pricePerMetrePaise: 18000, orderValuePaise: 90_000_000 });
    expect(order).not.toHaveProperty('requiredYarnKg');
    expect(order).not.toHaveProperty('createdBy');
    expect(order.statusHistory[0]).not.toHaveProperty('by');
  });

  it('answers 404 (not 403) when a buyer asks for another company\'s order', async () => {
    const res = await get(suratBuyer, `/api/orders/${tiruppurOrder._id}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Order not found' });
    const missing = await get(suratBuyer, '/api/orders/64b7f0c2a1b2c3d4e5f60718');
    expect(missing.body.error.message).toBe(res.body.error.message);
  });

  it('shows money to ADMIN only among staff; planning data to all staff', async () => {
    const admins = (await get(admin, `/api/orders/${suratOrder._id}`)).body.data.order;
    const floor = (await get(await createTestUser({ role: ROLES.FLOOR_MANAGER }), `/api/orders/${suratOrder._id}`)).body.data.order;

    expect(admins).toMatchObject({ orderValuePaise: 90_000_000, requiredYarnKg: 850 });
    expect(floor.requiredYarnKg).toBe(850);
    expect(floor).not.toHaveProperty('orderValuePaise');
    expect(floor).not.toHaveProperty('pricePerMetrePaise');
  });

  it('returns 400 for a malformed id', async () => {
    expect((await get(admin, '/api/orders/not-an-id')).status).toBe(400);
  });
});

describe('POST /api/orders/:id/cancel', () => {
  it('lets a buyer cancel their own new order, with history and audit', async () => {
    const res = await act(suratBuyer, suratOrder._id, 'cancel', { reason: 'Buyer changed plans' });

    expect(res.status).toBe(200);
    expect(res.body.data.order.status).toBe('CANCELLED');
    expect(res.body.data.order.statusHistory.at(-1)).toMatchObject({
      from: 'ORDER_CREATED',
      to: 'CANCELLED',
      byRole: 'BUYER',
      reason: 'Buyer changed plans',
    });
    const audit = await AuditLog.findOne({ action: 'ORDER_CANCELLED' }).lean();
    expect(audit).toMatchObject({ before: { status: 'ORDER_CREATED' }, after: { status: 'CANCELLED', reason: 'Buyer changed plans' } });
  });

  it('answers 404 when a buyer tries to cancel another company\'s order, and changes nothing', async () => {
    const res = await act(suratBuyer, tiruppurOrder._id, 'cancel');

    expect(res.status).toBe(404);
    expect((await Order.findById(tiruppurOrder._id).lean()).status).toBe('ORDER_CREATED');
  });

  it('lets an admin cancel any new order', async () => {
    expect((await act(admin, tiruppurOrder._id, 'cancel')).status).toBe(200);
  });

  it('returns 409 INVALID_STATE_TRANSITION when cancelling an already cancelled order', async () => {
    await act(suratBuyer, suratOrder._id, 'cancel');
    const res = await act(suratBuyer, suratOrder._id, 'cancel');

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      details: { from: 'CANCELLED', to: 'CANCELLED', allowed: [] },
    });
  });

  it('replays a retried cancel instead of failing it', async () => {
    const key = newKey();
    await act(suratBuyer, suratOrder._id, 'cancel', { reason: 'Buyer changed plans' }, key);
    const retry = await act(suratBuyer, suratOrder._id, 'cancel', { reason: 'Buyer changed plans' }, key);

    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(await AuditLog.countDocuments({ action: 'ORDER_CANCELLED' })).toBe(1);
  });

  it.each([ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR])('returns 403 for %s', async (role) => {
    expect((await act(await createTestUser({ role }), suratOrder._id, 'cancel')).status).toBe(403);
  });

  it.each([
    ['a missing reason', {}],
    ['a too-short reason', { reason: 'no' }],
    ['a status field', { reason: 'Buyer changed plans', status: 'CONFIRMED' }],
  ])('returns 400 for %s', async (_label, body) => {
    expect((await act(suratBuyer, suratOrder._id, 'cancel', body)).status).toBe(400);
  });
});

describe('POST /api/orders/:id/reject', () => {
  it('lets an admin reject a new order', async () => {
    const res = await act(admin, suratOrder._id, 'reject', { reason: 'Deadline cannot be met' });

    expect(res.status).toBe(200);
    expect(res.body.data.order.status).toBe('REJECTED');
    expect(await AuditLog.countDocuments({ action: 'ORDER_REJECTED' })).toBe(1);
  });

  it('is ADMIN only: a buyer cannot reject, even their own order', async () => {
    expect((await act(suratBuyer, suratOrder._id, 'reject')).status).toBe(403);
  });

  it('returns 409 when rejecting a cancelled order', async () => {
    await act(admin, suratOrder._id, 'cancel');
    const res = await act(admin, suratOrder._id, 'reject');

    expect(res.status).toBe(409);
    expect(res.body.error.details).toMatchObject({ from: 'CANCELLED', to: 'REJECTED' });
  });

  it('returns 409 when rejecting a confirmed order (it can only be reserved or cancelled now)', async () => {
    const confirmed = await createTestOrder({ buyer: surat, product, createdBy: admin._id, status: 'CONFIRMED' });
    const res = await act(admin, confirmed._id, 'reject');
    expect(res.status).toBe(409);
    expect(res.body.error.details.allowed).toEqual(['MATERIAL_RESERVED', 'CANCELLED']);
  });

  it('returns 409 for an order in a later status that has no transition yet', async () => {
    const later = await createTestOrder({ buyer: surat, product, createdBy: admin._id, status: 'INVOICED' });
    const res = await act(admin, later._id, 'reject');
    expect(res.status).toBe(409);
    expect(res.body.error.details.allowed).toEqual([]);
  });

  it('lets exactly one of a concurrent cancel and reject win', async () => {
    const results = await Promise.all([act(admin, suratOrder._id, 'cancel'), act(admin, suratOrder._id, 'reject')]);
    const statuses = results.map((res) => res.status).sort();

    expect(statuses).toEqual([200, 409]);
    const stored = await Order.findById(suratOrder._id).lean();
    expect(['CANCELLED', 'REJECTED']).toContain(stored.status);
    expect(stored.statusHistory).toHaveLength(2);
    expect(await AuditLog.countDocuments({ action: { $in: ['ORDER_CANCELLED', 'ORDER_REJECTED'] } })).toBe(1);
  });
});
