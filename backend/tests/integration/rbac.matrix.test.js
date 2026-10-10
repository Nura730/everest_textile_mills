import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ALL_ROLES, ROLES } from '../../src/constants/roles.js';
import { resetLoginRateLimits } from '../../src/middleware/rateLimit.js';
import { User } from '../../src/models/User.js';
import { YarnLot } from '../../src/models/YarnLot.js';
import { TEST_PASSWORD, bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import {
  clearCatalog,
  createTestBuyer,
  createTestOrder,
  createTestProduct,
  daysFromToday,
  ensureCatalogCollections,
} from '../helpers/catalog.js';
import { clearInventory, ensureInventoryCollections, newKey, receiptBody } from '../helpers/inventory.js';

/**
 * THE PERMISSION MATRIX. Every protected route and the roles allowed to call it.
 * Each later phase adds its routes here; a route missing from this table is a review flag.
 * `build` returns { path, body, headers } for a fresh, valid request so allowed roles get past
 * validation and the test checks authorization only.
 */
let seq = 0;
const STOCK_VIEWERS = [ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.ADMIN];
// Every BUYER actor belongs to this company, and orders built below belong to it too, so the
// matrix tests role permissions with ownership satisfied (ownership has its own tests).
let matrixBuyer;
let matrixProduct;
const newOrder = () => createTestOrder({ buyer: matrixBuyer, product: matrixProduct, createdBy: '64b7f0c2a1b2c3d4e5f60718' });

async function existingLot({ totalGrams = 100_000 } = {}) {
  seq += 1;
  return YarnLot.create({
    lotNumber: `MATRIX-${seq}`,
    material: 'COTTON',
    colour: 'Navy',
    supplierName: 'Matrix Supplier',
    costPerKgPaise: 30000,
    receivedAt: new Date(),
    receivedBy: '64b7f0c2a1b2c3d4e5f60718',
    totalGrams,
  });
}
const MATRIX = [
  {
    name: 'GET /api/auth/me',
    method: 'get',
    allowed: ALL_ROLES,
    build: async () => ({ path: '/api/auth/me' }),
  },
  {
    name: 'GET /api/users',
    method: 'get',
    allowed: [ROLES.ADMIN],
    build: async () => ({ path: '/api/users' }),
  },
  {
    name: 'POST /api/users',
    method: 'post',
    allowed: [ROLES.ADMIN],
    build: async () => {
      seq += 1;
      return {
        path: '/api/users',
        body: { name: 'Matrix User', email: `matrix-${seq}@everest.test`, password: TEST_PASSWORD, role: ROLES.QC_INSPECTOR },
      };
    },
  },
  {
    name: 'PATCH /api/users/:id/status',
    method: 'patch',
    allowed: [ROLES.ADMIN],
    build: async () => {
      const target = await createTestUser();
      return { path: `/api/users/${target._id}/status`, body: { isActive: false } };
    },
  },
  // ── Phase 3: inventory ──
  {
    name: 'GET /api/yarn-lots',
    method: 'get',
    allowed: STOCK_VIEWERS,
    build: async () => ({ path: '/api/yarn-lots' }),
  },
  {
    name: 'POST /api/yarn-lots',
    method: 'post',
    allowed: [ROLES.STORE_KEEPER, ROLES.ADMIN],
    build: async () => ({ path: '/api/yarn-lots', body: receiptBody(), headers: { 'Idempotency-Key': newKey() } }),
  },
  {
    name: 'GET /api/yarn-lots/:id',
    method: 'get',
    allowed: STOCK_VIEWERS,
    build: async () => ({ path: `/api/yarn-lots/${(await existingLot())._id}` }),
  },
  {
    name: 'GET /api/yarn-lots/:id/transactions',
    method: 'get',
    allowed: STOCK_VIEWERS,
    build: async () => ({ path: `/api/yarn-lots/${(await existingLot())._id}/transactions` }),
  },
  {
    name: 'POST /api/yarn-lots/:id/adjustments',
    method: 'post',
    allowed: [ROLES.ADMIN],
    build: async () => ({
      path: `/api/yarn-lots/${(await existingLot())._id}/adjustments`,
      body: { deltaKg: 1, reason: 'Matrix recount' },
      headers: { 'Idempotency-Key': newKey() },
    }),
  },
  {
    name: 'GET /api/inventory/yarn-summary',
    method: 'get',
    allowed: STOCK_VIEWERS,
    build: async () => ({ path: '/api/inventory/yarn-summary' }),
  },
  {
    name: 'GET /api/inventory/reconciliation',
    method: 'get',
    allowed: [ROLES.ADMIN],
    build: async () => ({ path: '/api/inventory/reconciliation' }),
  },
  // ── Phase 5: buyers, catalog, orders ──
  {
    name: 'GET /api/buyers',
    method: 'get',
    allowed: [ROLES.ADMIN],
    build: async () => ({ path: '/api/buyers' }),
  },
  {
    name: 'POST /api/buyers',
    method: 'post',
    allowed: [ROLES.ADMIN],
    build: async () => {
      seq += 1;
      return { path: '/api/buyers', body: { code: `BUY-M${seq}`, name: 'Matrix Buyer Co' } };
    },
  },
  {
    name: 'GET /api/buyers/:id',
    method: 'get',
    allowed: [ROLES.ADMIN],
    build: async () => ({ path: `/api/buyers/${matrixBuyer._id}` }),
  },
  {
    name: 'GET /api/products',
    method: 'get',
    allowed: ALL_ROLES,
    build: async () => ({ path: '/api/products' }),
  },
  {
    name: 'POST /api/products',
    method: 'post',
    allowed: [ROLES.ADMIN],
    build: async () => {
      seq += 1;
      return {
        path: '/api/products',
        body: {
          code: `MTX-${seq}`, name: 'Matrix Fabric', material: 'COTTON', colour: 'Navy', weave: 'PLAIN',
          widthCm: 150, gsm: 110, yarnGramsPerMetre: 170, pricePerMetrePaise: 18000,
        },
      };
    },
  },
  {
    name: 'GET /api/products/:id',
    method: 'get',
    allowed: ALL_ROLES,
    build: async () => ({ path: `/api/products/${matrixProduct._id}` }),
  },
  {
    name: 'GET /api/orders',
    method: 'get',
    allowed: ALL_ROLES,
    build: async () => ({ path: '/api/orders' }),
  },
  {
    name: 'POST /api/orders',
    method: 'post',
    allowed: [ROLES.BUYER, ROLES.ADMIN],
    // Only an ADMIN names the buyer; a buyer's body must not contain buyerId.
    build: async (actor) => ({
      path: '/api/orders',
      body: {
        productId: String(matrixProduct._id),
        quantityMetres: 100,
        requiredBy: daysFromToday(20),
        ...(actor?.role === ROLES.ADMIN ? { buyerId: String(matrixBuyer._id) } : {}),
      },
      headers: { 'Idempotency-Key': newKey() },
    }),
  },
  {
    name: 'GET /api/orders/:id',
    method: 'get',
    allowed: ALL_ROLES,
    build: async () => ({ path: `/api/orders/${(await newOrder())._id}` }),
  },
  // ── Phase 6: feasibility and confirmation ──
  {
    name: 'GET /api/orders/:id/feasibility',
    method: 'get',
    allowed: STOCK_VIEWERS,
    build: async () => ({ path: `/api/orders/${(await newOrder())._id}/feasibility` }),
  },
  {
    name: 'POST /api/orders/:id/confirm',
    method: 'post',
    allowed: [ROLES.ADMIN],
    // Enough Navy cotton for the order's 850 kg, so the allowed role passes feasibility.
    build: async () => {
      await existingLot({ totalGrams: 1_000_000 });
      return {
        path: `/api/orders/${(await newOrder())._id}/confirm`,
        body: {},
        headers: { 'Idempotency-Key': newKey() },
      };
    },
  },
  {
    name: 'POST /api/orders/:id/cancel',
    method: 'post',
    allowed: [ROLES.BUYER, ROLES.ADMIN],
    build: async () => ({
      path: `/api/orders/${(await newOrder())._id}/cancel`,
      body: { reason: 'Matrix cancellation' },
      headers: { 'Idempotency-Key': newKey() },
    }),
  },
  {
    name: 'POST /api/orders/:id/reject',
    method: 'post',
    allowed: [ROLES.ADMIN],
    build: async () => ({
      path: `/api/orders/${(await newOrder())._id}/reject`,
      body: { reason: 'Matrix rejection' },
      headers: { 'Idempotency-Key': newKey() },
    }),
  },
];

const actorFor = (role) => createTestUser({ role, ...(role === ROLES.BUYER ? { buyerId: matrixBuyer._id } : {}) });

let app;
let logs;

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await User.init();
  await ensureInventoryCollections();
  await ensureCatalogCollections();
});

beforeEach(async () => {
  logs = captureLogs();
  app = createApp({ logger: logs.logger });
  matrixBuyer = await createTestBuyer();
  matrixProduct = await createTestProduct();
});

afterEach(async () => {
  await User.deleteMany({});
  await clearInventory();
  await clearCatalog();
});

afterAll(async () => {
  await resetLoginRateLimits();
  await disconnectDatabase();
});

async function call(route, actor) {
  const { path, body, headers = {} } = await route.build(actor);
  let req = request(app)[route.method](path);
  if (actor) req = req.set('Authorization', bearer(actor));
  for (const [name, value] of Object.entries(headers)) req = req.set(name, value);
  return body === undefined ? req : req.send(body);
}

const cases = MATRIX.flatMap((route) =>
  ALL_ROLES.map((role) => [route.name, role, route.allowed.includes(role) ? 'allowed' : 'forbidden', route]),
);

describe('RBAC matrix', () => {
  it.each(MATRIX.map((route) => [route.name, route]))('%s returns 401 without a token', async (_name, route) => {
    const res = await call(route, null);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it.each(cases)('%s as %s is %s', async (_name, role, verdict, route) => {
    const actor = await actorFor(role);
    const res = await call(route, actor);

    if (verdict === 'allowed') {
      expect(res.status).toBeLessThan(400);
    } else {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });
});

describe('credential leak sweep', () => {
  it('no response body or log line anywhere in the API contains a password or bcrypt hash', async () => {
    const admin = await createTestUser({ role: ROLES.ADMIN });
    const bodies = [];

    bodies.push((await request(app).post('/api/auth/login').send({ email: admin.email, password: TEST_PASSWORD })).body);
    bodies.push((await request(app).post('/api/auth/login').send({ email: admin.email, password: 'nope-nope-nope' })).body);
    for (const route of MATRIX) {
      for (const role of ALL_ROLES) {
        const actor = role === ROLES.ADMIN ? admin : await actorFor(role);
        bodies.push((await call(route, actor)).body);
      }
    }

    const hashes = (await User.find().select('+passwordHash').lean()).map((user) => user.passwordHash);
    const everything = [...bodies.map((body) => JSON.stringify(body)), ...logs.raw].join('\n');

    expect(everything).not.toContain(TEST_PASSWORD);
    expect(everything).not.toMatch(/\$2[aby]\$\d\d\$/);
    for (const hash of hashes) expect(everything).not.toContain(hash);
  });
});
