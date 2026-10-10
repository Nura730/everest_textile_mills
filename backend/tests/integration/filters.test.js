import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { User } from '../../src/models/User.js';
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
import { clearInventory, ensureInventoryCollections, newKey, receiptBody } from '../helpers/inventory.js';

let app;
let admin;
let surat;
let tiruppur;
let suratBuyer;
let navy;
let white;

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await ensureCatalogCollections();
  await ensureInventoryCollections();
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN, name: 'Asha Admin' });
  surat = await createTestBuyer({ code: 'BUY-SRT', name: 'Surat Fabrics' });
  tiruppur = await createTestBuyer({ code: 'BUY-TPR', name: 'Tiruppur Knits' });
  suratBuyer = await createTestUser({ role: ROLES.BUYER, buyerId: surat._id });
  navy = await createTestProduct({ code: 'COT-NAVY-PLAIN', name: 'Navy Cotton Plain' });
  white = await createTestProduct({ code: 'POL-WHITE-TWILL', name: 'White Poly Twill', material: 'POLYESTER', colour: 'White', weave: 'TWILL' });
});

afterEach(async () => {
  await clearCatalog();
  await clearInventory();
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

const get = (actor, path) => request(app).get(path).set('Authorization', bearer(actor));
const ids = (res) => res.body.data.orders.map((order) => order.orderNumber).sort();
const order = (buyer, product, { status = 'ORDER_CREATED', days = 10, orderNumber } = {}) =>
  createTestOrder({ buyer, product, createdBy: admin._id, status, requiredBy: dateStringToDate(daysFromToday(days)), ...(orderNumber ? { orderNumber } : {}) });

describe('GET /api/orders filters', () => {
  beforeEach(async () => {
    await order(surat, navy, { orderNumber: 'ORD-2026-0001', days: -3 }); // overdue, open
    await order(surat, white, { orderNumber: 'ORD-2026-0002', days: 5, status: 'CONFIRMED' });
    await order(tiruppur, navy, { orderNumber: 'ORD-2026-0003', days: -1, status: 'CONFIRMED' }); // overdue, confirmed
    await order(tiruppur, white, { orderNumber: 'ORD-2026-0004', days: -10, status: 'CANCELLED' }); // past but closed
    await order(surat, navy, { orderNumber: 'ORD-2026-0005', days: 0 }); // due today: not overdue
    await order(tiruppur, navy, { orderNumber: 'ORD-2026-0006', days: 40, status: 'REJECTED' });
  });

  it('overdue = deadline before today AND delivery still pending (cancelled/rejected and due-today excluded)', async () => {
    expect(ids(await get(admin, '/api/orders?overdue=true'))).toEqual(['ORD-2026-0001', 'ORD-2026-0003']);
  });

  it('overdue=false is the same as no overdue filter', async () => {
    expect((await get(admin, '/api/orders?overdue=false')).body.meta.total).toBe(6);
  });

  it('combines overdue with status (and a closed status matches nothing)', async () => {
    expect(ids(await get(admin, '/api/orders?overdue=true&status=CONFIRMED'))).toEqual(['ORD-2026-0003']);
    expect((await get(admin, '/api/orders?overdue=true&status=CANCELLED')).body.meta.total).toBe(0);
  });

  it('filters by product and by buyer company', async () => {
    expect(ids(await get(admin, `/api/orders?productId=${white._id}`))).toEqual(['ORD-2026-0002', 'ORD-2026-0004']);
    expect(ids(await get(admin, `/api/orders?buyerId=${tiruppur._id}&productId=${navy._id}`))).toEqual(['ORD-2026-0003', 'ORD-2026-0006']);
  });

  it('filters by an inclusive required-by date range', async () => {
    const res = await get(admin, `/api/orders?requiredFrom=${daysFromToday(-3)}&requiredTo=${daysFromToday(0)}`);
    expect(ids(res)).toEqual(['ORD-2026-0001', 'ORD-2026-0003', 'ORD-2026-0005']);
    expect(ids(await get(admin, `/api/orders?requiredFrom=${daysFromToday(5)}`))).toEqual(['ORD-2026-0002', 'ORD-2026-0006']);
  });

  it('combines a date range with overdue (both must hold)', async () => {
    expect(ids(await get(admin, `/api/orders?overdue=true&requiredFrom=${daysFromToday(-2)}`))).toEqual(['ORD-2026-0003']);
  });

  it('searches order number, buyer and product, case-insensitively', async () => {
    expect(ids(await get(admin, '/api/orders?q=0002'))).toEqual(['ORD-2026-0002']);
    expect((await get(admin, '/api/orders?q=tiruppur')).body.meta.total).toBe(3);
    expect((await get(admin, '/api/orders?q=buy-srt')).body.meta.total).toBe(3);
    expect((await get(admin, '/api/orders?q=white%20poly')).body.meta.total).toBe(2);
  });

  it('treats regex characters in the search literally', async () => {
    expect((await get(admin, '/api/orders?q=.*')).body.meta.total).toBe(0);
    expect((await get(admin, '/api/orders?q=ORD-2026-000(')).status).toBe(200);
  });

  it('a blank search means no search', async () => {
    expect((await get(admin, '/api/orders?q=%20%20')).body.meta.total).toBe(6);
  });

  it('keeps a buyer inside their own company whatever filters they send', async () => {
    const res = await get(suratBuyer, `/api/orders?buyerId=${tiruppur._id}&q=tiruppur`);
    expect(res.body.meta.total).toBe(0);
    expect(ids(await get(suratBuyer, '/api/orders?overdue=true'))).toEqual(['ORD-2026-0001']);
    expect((await get(suratBuyer, '/api/orders')).body.meta.total).toBe(3);
  });

  it('keeps the total and paging consistent with the filter', async () => {
    const first = await get(admin, '/api/orders?productId=' + navy._id + '&limit=2&page=1');
    const second = await get(admin, '/api/orders?productId=' + navy._id + '&limit=2&page=2');
    expect(first.body.meta.total).toBe(4);
    expect(first.body.data.orders).toHaveLength(2);
    expect(second.body.data.orders).toHaveLength(2);
  });

  it.each([
    ['a reversed date range', `requiredFrom=${daysFromToday(5)}&requiredTo=${daysFromToday(1)}`, 'requiredTo'],
    ['an impossible date', 'requiredFrom=2026-02-30', 'requiredFrom'],
    ['a non-date', 'requiredTo=yesterday', 'requiredTo'],
    ['a malformed product id', 'productId=nope', 'productId'],
    ['a non-boolean overdue', 'overdue=maybe', 'overdue'],
    ['an unknown status', 'status=SHIPPED', 'status'],
    ['an over-long search', `q=${'x'.repeat(101)}`, 'q'],
  ])('returns 400 for %s', async (_label, query, path) => {
    const res = await get(admin, `/api/orders?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((detail) => detail.path)).toContain(path);
  });
});

describe('GET /api/products filters', () => {
  beforeEach(async () => {
    await createTestProduct({ code: 'COT-RED-SATIN', name: 'Red Cotton Satin', colour: 'Red', weave: 'SATIN', isActive: false });
  });

  it('filters by weave, material and colour, and searches code or name', async () => {
    const codes = (res) => res.body.data.products.map((product) => product.code).sort();
    expect(codes(await get(admin, '/api/products?weave=TWILL'))).toEqual(['POL-WHITE-TWILL']);
    expect(codes(await get(admin, '/api/products?material=COTTON&colour=navy'))).toEqual(['COT-NAVY-PLAIN']);
    expect(codes(await get(admin, '/api/products?q=twill'))).toEqual(['POL-WHITE-TWILL']);
  });

  it('lets an admin list only inactive, only active, or both', async () => {
    expect((await get(admin, '/api/products?isActive=false')).body.data.products.map((p) => p.code)).toEqual(['COT-RED-SATIN']);
    expect((await get(admin, '/api/products?isActive=true')).body.meta.total).toBe(2);
    expect((await get(admin, '/api/products?includeInactive=true')).body.meta.total).toBe(3);
  });

  it('never shows inactive products to other roles, even when asked', async () => {
    for (const role of [ROLES.BUYER, ROLES.STORE_KEEPER]) {
      const actor = await createTestUser({ role, ...(role === ROLES.BUYER ? { buyerId: surat._id } : {}) });
      expect((await get(actor, '/api/products?isActive=false')).body.meta.total).toBe(2);
      expect((await get(actor, '/api/products?includeInactive=true&q=red')).body.meta.total).toBe(0);
    }
  });

  it('returns 400 for an unknown weave', async () => {
    expect((await get(admin, '/api/products?weave=KNIT')).status).toBe(400);
  });
});

describe('GET /api/users and /api/buyers search', () => {
  it('finds users by name or email, combined with role and status', async () => {
    await createTestUser({ role: ROLES.QC_INSPECTOR, name: 'Meena Iyer', email: 'meena@everest.test' });
    await createTestUser({ role: ROLES.QC_INSPECTOR, name: 'Ravi Kumar', isActive: false });
    expect((await get(admin, '/api/users?q=meena')).body.data.users.map((u) => u.name)).toEqual(['Meena Iyer']);
    expect((await get(admin, '/api/users?q=everest.test&role=QC_INSPECTOR&isActive=false')).body.data.users.map((u) => u.name)).toEqual(['Ravi Kumar']);
  });

  it('finds buyers by code or name, combined with status', async () => {
    await createTestBuyer({ code: 'BUY-OLD', name: 'Old Surat Traders', isActive: false });
    expect((await get(admin, '/api/buyers?q=surat')).body.meta.total).toBe(2);
    expect((await get(admin, '/api/buyers?q=surat&isActive=true')).body.data.buyers.map((b) => b.code)).toEqual(['BUY-SRT']);
    expect((await get(admin, '/api/buyers?q=tpr')).body.data.buyers.map((b) => b.code)).toEqual(['BUY-TPR']);
  });
});

describe('GET /api/yarn-lots/:id/transactions filters', () => {
  it('filters the ledger by movement type and Indian calendar date range', async () => {
    const store = await createTestUser({ role: ROLES.STORE_KEEPER });
    const lot = (await request(app).post('/api/yarn-lots').set('Authorization', bearer(store)).set('Idempotency-Key', newKey()).send(receiptBody())).body.data.lot;
    await request(app).post(`/api/yarn-lots/${lot.id}/adjustments`).set('Authorization', bearer(admin)).set('Idempotency-Key', newKey()).send({ deltaKg: -1, reason: 'Wet cone written off' });
    const path = `/api/yarn-lots/${lot.id}/transactions`;
    const types = (res) => res.body.data.transactions.map((tx) => tx.type);

    expect(types(await get(store, `${path}?type=ADJUSTMENT`))).toEqual(['ADJUSTMENT']);
    expect(types(await get(store, `${path}?from=${daysFromToday(0)}&to=${daysFromToday(0)}`))).toHaveLength(2);
    expect((await get(store, `${path}?to=${daysFromToday(-1)}`)).body.meta.total).toBe(0);
    expect((await get(store, `${path}?from=${daysFromToday(1)}`)).body.meta.total).toBe(0);
    expect((await get(store, `${path}?type=RECEIPT&from=${daysFromToday(-7)}`)).body.meta.total).toBe(1);
    expect((await get(store, `${path}?type=TELEPORT`)).status).toBe(400);
    expect((await get(store, `${path}?from=${daysFromToday(2)}&to=${daysFromToday(1)}`)).status).toBe(400);
  });
});
