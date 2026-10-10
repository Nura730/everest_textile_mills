import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { Product } from '../../src/models/Product.js';
import { User } from '../../src/models/User.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { clearCatalog, createTestBuyer, createTestProduct, ensureCatalogCollections } from '../helpers/catalog.js';

let app;
let admin;

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await ensureCatalogCollections();
  await AuditLog.createCollection();
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
});

afterEach(async () => {
  await clearCatalog();
  await AuditLog.collection.deleteMany({});
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

const as = (actor) => ({
  get: (path) => request(app).get(path).set('Authorization', bearer(actor)),
  post: (path, body) => request(app).post(path).set('Authorization', bearer(actor)).send(body),
});

const buyerBody = (overrides = {}) => ({
  code: 'buy-srt',
  name: 'Surat Fabrics Pvt Ltd',
  contactName: 'Priya Shah',
  email: 'Orders@SuratFabrics.example',
  phone: '+91 98250 12345',
  address: 'Ring Road, Surat, Gujarat',
  ...overrides,
});

const productBody = (overrides = {}) => ({
  code: 'cot-navy-plain',
  name: 'Navy Cotton Plain',
  material: 'COTTON',
  colour: 'navy',
  weave: 'PLAIN',
  widthCm: 150,
  gsm: 110,
  yarnGramsPerMetre: 170,
  pricePerMetrePaise: 18000,
  ...overrides,
});

describe('buyers', () => {
  it('creates a buyer company (ADMIN), normalising code and email, with an audit entry', async () => {
    const res = await as(admin).post('/api/buyers', buyerBody());

    expect(res.status).toBe(201);
    expect(res.body.data.buyer).toEqual({
      id: expect.any(String),
      code: 'BUY-SRT',
      name: 'Surat Fabrics Pvt Ltd',
      contactName: 'Priya Shah',
      email: 'orders@suratfabrics.example',
      phone: '+91 98250 12345',
      address: 'Ring Road, Surat, Gujarat',
      isActive: true,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(await AuditLog.countDocuments({ action: 'BUYER_CREATED' })).toBe(1);
  });

  it('rejects a duplicate code with 409 DUPLICATE_RESOURCE', async () => {
    await as(admin).post('/api/buyers', buyerBody());
    const res = await as(admin).post('/api/buyers', buyerBody({ code: 'BUY-SRT', name: 'Another' }));

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'DUPLICATE_RESOURCE', details: { fields: ['code'] } });
    expect(await AuditLog.countDocuments({ action: 'BUYER_CREATED' })).toBe(1);
  });

  it.each([
    ['a missing name', { name: undefined }, 'name'],
    ['a bad email', { email: 'not-an-email' }, 'email'],
    ['a bad phone', { phone: 'call me' }, 'phone'],
    ['an unknown field', { isActive: false }, ''],
  ])('returns 400 for %s', async (_label, overrides, path) => {
    const res = await as(admin).post('/api/buyers', buyerBody(overrides));
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
  });

  it('lists buyers by name and filters by isActive', async () => {
    await createTestBuyer({ name: 'Zeta Mills' });
    await createTestBuyer({ name: 'Alpha Traders' });
    await createTestBuyer({ name: 'Old Customer', isActive: false });

    const all = await as(admin).get('/api/buyers');
    const active = await as(admin).get('/api/buyers?isActive=true');

    expect(all.body.data.buyers.map((buyer) => buyer.name)).toEqual(['Alpha Traders', 'Old Customer', 'Zeta Mills']);
    expect(active.body.meta.total).toBe(2);
  });

  it('gets one buyer, 404 for unknown', async () => {
    const buyer = await createTestBuyer();
    expect((await as(admin).get(`/api/buyers/${buyer._id}`)).body.data.buyer.code).toBe(buyer.code);
    expect((await as(admin).get('/api/buyers/64b7f0c2a1b2c3d4e5f60718')).status).toBe(404);
  });

  it.each([ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.BUYER])('is ADMIN only (%s gets 403)', async (role) => {
    const actor = await createTestUser({ role });
    expect((await as(actor).post('/api/buyers', buyerBody())).status).toBe(403);
    expect((await as(actor).get('/api/buyers')).status).toBe(403);
  });
});

describe('products', () => {
  it('creates a product (ADMIN) with normalised code and colour, and an audit entry', async () => {
    const res = await as(admin).post('/api/products', productBody());

    expect(res.status).toBe(201);
    expect(res.body.data.product).toEqual({
      id: expect.any(String),
      code: 'COT-NAVY-PLAIN',
      name: 'Navy Cotton Plain',
      material: 'COTTON',
      colour: 'Navy',
      weave: 'PLAIN',
      widthCm: 150,
      gsm: 110,
      machineType: 'WEAVING',
      pricePerMetrePaise: 18000,
      yarnGramsPerMetre: 170,
      isActive: true,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(await AuditLog.countDocuments({ action: 'PRODUCT_CREATED' })).toBe(1);
  });

  it('refuses yarn consumption below the fabric weight per metre (gsm × width)', async () => {
    // 110 g/m² × 1.5 m = 165 g per metre of fabric
    const tooLow = await as(admin).post('/api/products', productBody({ yarnGramsPerMetre: 164 }));
    const exact = await as(admin).post('/api/products', productBody({ yarnGramsPerMetre: 165 }));

    expect(tooLow.status).toBe(400);
    expect(tooLow.body.error.details[0]).toMatchObject({ path: 'yarnGramsPerMetre', message: expect.stringContaining('165') });
    expect(exact.status).toBe(201);
  });

  it.each([
    ['an unknown material', { material: 'JUTE' }, 'material'],
    ['an unknown weave', { weave: 'KNIT' }, 'weave'],
    ['a fractional gsm', { gsm: 110.5 }, 'gsm'],
    ['a zero price', { pricePerMetrePaise: 0 }, 'pricePerMetrePaise'],
    ['a fractional price', { pricePerMetrePaise: 180.5 }, 'pricePerMetrePaise'],
    ['an internal field', { defaultPricePerMetrePaise: 1 }, ''],
  ])('returns 400 for %s', async (_label, overrides, path) => {
    const res = await as(admin).post('/api/products', productBody(overrides));
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
  });

  it('rejects a duplicate product code', async () => {
    await as(admin).post('/api/products', productBody());
    const res = await as(admin).post('/api/products', productBody());
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ fields: ['code'] });
  });

  it('shows the yarn spec to staff but not to buyers', async () => {
    await createTestProduct();
    const buyer = await createTestUser({ role: ROLES.BUYER });
    const floor = await createTestUser({ role: ROLES.FLOOR_MANAGER });

    const forBuyer = (await as(buyer).get('/api/products')).body.data.products[0];
    const forFloor = (await as(floor).get('/api/products')).body.data.products[0];

    expect(forBuyer).not.toHaveProperty('yarnGramsPerMetre');
    expect(forBuyer.pricePerMetrePaise).toBe(18000);
    expect(forFloor.yarnGramsPerMetre).toBe(170);
  });

  it('hides inactive products from everyone except an ADMIN who asks', async () => {
    const retired = await createTestProduct({ isActive: false });
    await createTestProduct();
    const buyer = await createTestUser({ role: ROLES.BUYER });

    expect((await as(buyer).get('/api/products?includeInactive=true')).body.meta.total).toBe(1);
    expect((await as(admin).get('/api/products')).body.meta.total).toBe(1);
    expect((await as(admin).get('/api/products?includeInactive=true')).body.meta.total).toBe(2);
    expect((await as(buyer).get(`/api/products/${retired._id}`)).status).toBe(404);
    expect((await as(admin).get(`/api/products/${retired._id}`)).status).toBe(200);
  });

  it('filters by material and colour', async () => {
    await createTestProduct();
    await createTestProduct({ material: 'POLYESTER', colour: 'White' });

    const res = await as(admin).get('/api/products?material=POLYESTER&colour=white');
    expect(res.body.data.products).toHaveLength(1);
    expect(res.body.data.products[0].colour).toBe('White');
  });

  it('only ADMIN can create products', async () => {
    const keeper = await createTestUser({ role: ROLES.STORE_KEEPER });
    expect((await as(keeper).post('/api/products', productBody())).status).toBe(403);
    expect(await Product.countDocuments()).toBe(0);
  });
});
