import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { Buyer } from '../../src/models/Buyer.js';
import { IdempotencyRecord } from '../../src/models/IdempotencyRecord.js';
import { Order } from '../../src/models/Order.js';
import { Product } from '../../src/models/Product.js';
import { User } from '../../src/models/User.js';
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
let surat;
let tiruppur;
let suratBuyer;
let tiruppurBuyer;
let product;

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await ensureCatalogCollections();
  await ensureInventoryCollections();
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
  surat = await createTestBuyer({ code: 'BUY-SRT', name: 'Surat Fabrics', phone: '+91 98250 12345' });
  tiruppur = await createTestBuyer({ code: 'BUY-TPR', name: 'Tiruppur Knits' });
  suratBuyer = await createTestUser({ role: ROLES.BUYER, buyerId: surat._id });
  tiruppurBuyer = await createTestUser({ role: ROLES.BUYER, buyerId: tiruppur._id });
  product = await createTestProduct(); // 150 cm × 110 gsm → fabric weighs 165 g/m; yarn 170 g/m
});

afterEach(async () => {
  await clearCatalog();
  await clearInventory();
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

const patch = (actor, path, body, key) => {
  let req = request(app).patch(path).set('Authorization', bearer(actor));
  if (key) req = req.set('Idempotency-Key', key);
  return req.send(body);
};
const stamp = (doc) => doc.updatedAt.toISOString();
const audits = (action) => AuditLog.countDocuments({ action });

describe('PATCH /api/buyers/:id', () => {
  it('updates contact details, keeps the code, audits only what changed', async () => {
    const res = await patch(admin, `/api/buyers/${surat._id}`, {
      expectedUpdatedAt: stamp(surat),
      name: 'Surat Fabrics Pvt Ltd',
      email: 'Orders@SuratFabrics.example',
      phone: '+91 98250 12345', // unchanged: not in the audit entry
    });

    expect(res.status).toBe(200);
    expect(res.body.data.buyer).toMatchObject({ code: 'BUY-SRT', name: 'Surat Fabrics Pvt Ltd', email: 'orders@suratfabrics.example' });
    const audit = await AuditLog.findOne({ action: 'BUYER_UPDATED' }).lean();
    expect(audit.before).toEqual({ name: 'Surat Fabrics', email: null });
    expect(audit.after).toEqual({ name: 'Surat Fabrics Pvt Ltd', email: 'orders@suratfabrics.example' });
    expect((await Buyer.findById(surat._id).lean()).name).toBe('Surat Fabrics Pvt Ltd');
  });

  it('clears an optional contact field with null', async () => {
    const res = await patch(admin, `/api/buyers/${surat._id}`, { expectedUpdatedAt: stamp(surat), phone: null });
    expect(res.body.data.buyer.phone).toBeNull();
  });

  it('does not rewrite existing orders (they keep their snapshot of the name)', async () => {
    const order = await createTestOrder({ buyer: surat, product, createdBy: admin._id });
    await patch(admin, `/api/buyers/${surat._id}`, { expectedUpdatedAt: stamp(surat), name: 'Renamed Co' });
    expect((await Order.findById(order._id).lean()).buyer.name).toBe('Surat Fabrics');
  });

  it.each([
    ['the code', { code: 'BUY-NEW' }],
    ['the status (own endpoint)', { isActive: false }],
    ['createdBy', { createdBy: '64b7f0c2a1b2c3d4e5f60718' }],
  ])('rejects a body that tries to change %s (400) and changes nothing', async (_label, extra) => {
    const res = await patch(admin, `/api/buyers/${surat._id}`, { expectedUpdatedAt: stamp(surat), name: 'Sneaky', ...extra });
    expect(res.status).toBe(400);
    expect((await Buyer.findById(surat._id).lean()).name).toBe('Surat Fabrics');
  });

  it.each([
    ['no editable field', {}],
    ['a one-letter name', { name: 'X' }],
    ['a bad email', { email: 'not-an-email' }],
  ])('returns 400 for %s', async (_label, body) => {
    expect((await patch(admin, `/api/buyers/${surat._id}`, { expectedUpdatedAt: stamp(surat), ...body })).status).toBe(400);
  });

  it('requires expectedUpdatedAt', async () => {
    expect((await patch(admin, `/api/buyers/${surat._id}`, { name: 'No stamp Co' })).status).toBe(400);
  });

  it('refuses a stale save (someone else saved first) with 409 CONFLICT', async () => {
    const loaded = stamp(surat);
    expect((await patch(admin, `/api/buyers/${surat._id}`, { expectedUpdatedAt: loaded, name: 'First Save Co' })).status).toBe(200);
    const second = await patch(admin, `/api/buyers/${surat._id}`, { expectedUpdatedAt: loaded, name: 'Second Save Co' });

    expect(second.status).toBe(409);
    expect(second.body.error).toMatchObject({ code: 'CONFLICT', details: { reason: 'STALE_EDIT' } });
    expect((await Buyer.findById(surat._id).lean()).name).toBe('First Save Co');
  });

  it('treats a retried identical save as success, not as stale', async () => {
    const body = { expectedUpdatedAt: stamp(surat), name: 'Retried Co' };
    await patch(admin, `/api/buyers/${surat._id}`, body);
    const retry = await patch(admin, `/api/buyers/${surat._id}`, body);
    expect(retry.status).toBe(200);
    expect(await audits('BUYER_UPDATED')).toBe(1);
  });

  it('returns 404 for an unknown buyer', async () => {
    expect((await patch(admin, '/api/buyers/64b7f0c2a1b2c3d4e5f60718', { expectedUpdatedAt: stamp(surat), name: 'Ghost Co' })).status).toBe(404);
  });
});

describe('PATCH /api/buyers/:id/status', () => {
  it('deactivates (audited); the company can then not order; same status again is a no-op', async () => {
    const res = await patch(admin, `/api/buyers/${surat._id}/status`, { isActive: false });
    expect(res.body.data.buyer.isActive).toBe(false);
    expect((await patch(admin, `/api/buyers/${surat._id}/status`, { isActive: false })).status).toBe(200);
    expect(await audits('BUYER_STATUS_CHANGED')).toBe(1);

    const order = await request(app).post('/api/orders').set('Authorization', bearer(suratBuyer)).set('Idempotency-Key', newKey())
      .send({ productId: String(product._id), quantityMetres: 100, requiredBy: daysFromToday(20) });
    expect(order.body.error.code).toBe('BUYER_INACTIVE');
  });

  it('rejects anything but a boolean isActive', async () => {
    expect((await patch(admin, `/api/buyers/${surat._id}/status`, { isActive: 'no' })).status).toBe(400);
    expect((await patch(admin, `/api/buyers/${surat._id}/status`, { isActive: false, name: 'x' })).status).toBe(400);
  });
});

describe('PATCH /api/products/:id', () => {
  it('updates name, price and yarn spec for future orders; existing orders keep their snapshot', async () => {
    const order = await createTestOrder({ buyer: surat, product, createdBy: admin._id });
    const res = await patch(admin, `/api/products/${product._id}`, {
      expectedUpdatedAt: stamp(product),
      name: 'Navy Cotton Plain (new)',
      pricePerMetrePaise: 19500,
      yarnGramsPerMetre: 175,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.product).toMatchObject({ code: product.code, pricePerMetrePaise: 19500, yarnGramsPerMetre: 175 });
    const stored = await Order.findById(order._id).lean();
    expect(stored.product).toMatchObject({ pricePerMetrePaise: 18000, yarnGramsPerMetre: 170 });
    expect(stored.orderValuePaise).toBe(90_000_000);
    const audit = await AuditLog.findOne({ action: 'PRODUCT_UPDATED' }).lean();
    expect(audit.after).toEqual({ name: 'Navy Cotton Plain (new)', defaultPricePerMetrePaise: 19500, yarnGramsPerMetre: 175 });

    const newOrder = await request(app).post('/api/orders').set('Authorization', bearer(suratBuyer)).set('Idempotency-Key', newKey())
      .send({ productId: String(product._id), quantityMetres: 100, requiredBy: daysFromToday(20) });
    expect(newOrder.body.data.order.pricePerMetrePaise).toBe(19500);
  });

  it('enforces yarn ≥ fabric weight against the stored width and GSM, and changes nothing on failure', async () => {
    const res = await patch(admin, `/api/products/${product._id}`, { expectedUpdatedAt: stamp(product), yarnGramsPerMetre: 160, name: 'Thin Co' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ path: 'yarnGramsPerMetre' });
    expect(await Product.findById(product._id).lean()).toMatchObject({ yarnGramsPerMetre: 170, name: 'Navy Cotton Plain' });
    expect(await audits('PRODUCT_UPDATED')).toBe(0);
  });

  it.each([
    ['code', { code: 'NEW-CODE' }],
    ['material', { material: 'SILK' }],
    ['colour', { colour: 'Red' }],
    ['weave', { weave: 'TWILL' }],
    ['width', { widthCm: 200 }],
    ['gsm', { gsm: 200 }],
  ])('rejects a change to the fabric-defining field %s (400)', async (_label, extra) => {
    expect((await patch(admin, `/api/products/${product._id}`, { expectedUpdatedAt: stamp(product), ...extra })).status).toBe(400);
  });

  it.each([['a zero price', { pricePerMetrePaise: 0 }], ['fractional paise', { pricePerMetrePaise: 100.5 }]])('returns 400 for %s', async (_l, body) => {
    expect((await patch(admin, `/api/products/${product._id}`, { expectedUpdatedAt: stamp(product), ...body })).status).toBe(400);
  });

  it('retires a product: no longer orderable; existing orders are unaffected', async () => {
    const order = await createTestOrder({ buyer: surat, product, createdBy: admin._id });
    expect((await patch(admin, `/api/products/${product._id}/status`, { isActive: false })).body.data.product.isActive).toBe(false);
    expect((await Order.findById(order._id).lean()).status).toBe('ORDER_CREATED');
    const res = await request(app).post('/api/orders').set('Authorization', bearer(suratBuyer)).set('Idempotency-Key', newKey())
      .send({ productId: String(product._id), quantityMetres: 100, requiredBy: daysFromToday(20) });
    expect(res.body.error.code).toBe('PRODUCT_INACTIVE');
    expect(await audits('PRODUCT_STATUS_CHANGED')).toBe(1);
  });
});

describe('PATCH /api/orders/:id', () => {
  let order;
  beforeEach(async () => {
    order = await createTestOrder({ buyer: surat, product, createdBy: admin._id }); // 5,000 m, 850 kg, ₹9,00,000
  });
  const edit = (actor, body, key = newKey()) => patch(actor, `/api/orders/${order._id}`, { expectedUpdatedAt: stamp(order), ...body }, key);

  it('lets the owning buyer change quantity, date and notes; recalculates yarn and value on the server', async () => {
    const res = await edit(suratBuyer, { quantityMetres: 2000, requiredBy: daysFromToday(25), buyerNotes: 'Pack in 50 m rolls' });

    expect(res.status).toBe(200);
    expect(res.body.data.order).toMatchObject({
      status: 'ORDER_CREATED', quantityMetres: 2000, requiredBy: daysFromToday(25), buyerNotes: 'Pack in 50 m rolls', orderValuePaise: 36_000_000,
    });
    const stored = await Order.findById(order._id).lean();
    expect(stored).toMatchObject({ quantityCm: 200_000, requiredYarnGrams: 340_000, orderValuePaise: 36_000_000 });
    expect(stored.statusHistory).toHaveLength(1);
    const audit = await AuditLog.findOne({ action: 'ORDER_UPDATED' }).lean();
    expect(audit.before).toMatchObject({ quantityCm: 500_000, requiredYarnGrams: 850_000, orderValuePaise: 90_000_000 });
    expect(audit.after).toMatchObject({ quantityCm: 200_000, requiredYarnGrams: 340_000, orderValuePaise: 36_000_000, buyerNotes: 'Pack in 50 m rolls' });
  });

  it('uses the order\'s own price snapshot, not a later catalog price', async () => {
    await Product.updateOne({ _id: product._id }, { $set: { defaultPricePerMetrePaise: 99_999 } });
    const res = await edit(suratBuyer, { quantityMetres: 1000 });
    expect(res.body.data.order.orderValuePaise).toBe(18_000_000);
  });

  it('lets an admin edit and clear the notes', async () => {
    await Order.updateOne({ _id: order._id }, { $set: { buyerNotes: 'old note' } });
    order = await Order.findById(order._id);
    expect((await edit(admin, { buyerNotes: null })).body.data.order.buyerNotes).toBeNull();
  });

  it('answers 404 to another company\'s buyer and changes nothing', async () => {
    expect((await edit(tiruppurBuyer, { quantityMetres: 1 })).status).toBe(404);
    expect((await Order.findById(order._id).lean()).quantityCm).toBe(500_000);
  });

  it.each([ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR])('returns 403 for %s', async (role) => {
    expect((await edit(await createTestUser({ role }), { quantityMetres: 1 })).status).toBe(403);
  });

  it.each([
    ['status', { status: 'CONFIRMED' }],
    // Fixed ids: it.each tables are built before beforeEach runs, and any id must be refused.
    ['the product', { productId: '64b7f0c2a1b2c3d4e5f60718' }],
    ['the buyer company', { buyerId: '64b7f0c2a1b2c3d4e5f60719' }],
    ['the price', { pricePerMetrePaise: 1 }],
    ['the order value', { orderValuePaise: 1 }],
    ['the yarn requirement', { requiredYarnGrams: 1 }],
    ['the order number', { orderNumber: 'ORD-HACK' }],
  ])('rejects an attempt to change %s (400) and changes nothing', async (_label, extra) => {
    const res = await edit(suratBuyer, { quantityMetres: 10, ...extra });
    expect(res.status).toBe(400);
    expect((await Order.findById(order._id).lean()).quantityCm).toBe(500_000);
  });

  it.each([
    ['a past date', { requiredBy: daysFromToday(-1) }],
    ['today', { requiredBy: daysFromToday(0) }],
    ['zero quantity', { quantityMetres: 0 }],
    ['3 decimals', { quantityMetres: 1.555 }],
    ['nothing to change', {}],
  ])('returns 400 for %s', async (_label, body) => {
    expect((await edit(suratBuyer, body)).status).toBe(400);
  });

  it.each(['CONFIRMED', 'CANCELLED', 'REJECTED'])('refuses to edit a %s order (409 ORDER_NOT_EDITABLE)', async (status) => {
    await Order.updateOne({ _id: order._id }, { $set: { status } });
    order = await Order.findById(order._id);
    const res = await edit(admin, { quantityMetres: 10 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'ORDER_NOT_EDITABLE', details: { status } });
  });

  it('refuses a quantity change once the product is retired, but still allows notes', async () => {
    await Product.updateOne({ _id: product._id }, { $set: { isActive: false } });
    expect((await edit(suratBuyer, { quantityMetres: 10 })).body.error.code).toBe('PRODUCT_INACTIVE');
    expect((await edit(suratBuyer, { buyerNotes: 'Still waiting' })).status).toBe(200);
  });

  it('refuses a stale save with 409 CONFLICT', async () => {
    const loaded = stamp(order);
    await patch(admin, `/api/orders/${order._id}`, { expectedUpdatedAt: loaded, quantityMetres: 100 }, newKey());
    const res = await patch(suratBuyer, `/api/orders/${order._id}`, { expectedUpdatedAt: loaded, quantityMetres: 200 }, newKey());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect((await Order.findById(order._id).lean()).quantityCm).toBe(10_000);
  });

  it('replays a retried edit (same key) instead of applying it twice', async () => {
    const key = newKey();
    await edit(suratBuyer, { quantityMetres: 100 }, key);
    const retry = await edit(suratBuyer, { quantityMetres: 100 }, key);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(await audits('ORDER_UPDATED')).toBe(1);
  });

  it('requires an Idempotency-Key', async () => {
    expect((await patch(suratBuyer, `/api/orders/${order._id}`, { expectedUpdatedAt: stamp(order), quantityMetres: 10 })).status).toBe(400);
    expect(await IdempotencyRecord.countDocuments()).toBe(0);
  });

  it('cannot race a confirmation: exactly one of edit and confirm applies', async () => {
    const { YarnLot } = await import('../../src/models/YarnLot.js');
    await YarnLot.create({ lotNumber: 'EDIT-RACE', material: 'COTTON', colour: 'Navy', supplierName: 'Supplier', costPerKgPaise: 1, receivedAt: new Date(), receivedBy: admin._id, totalGrams: 5_000_000 });
    const [edited, confirmed] = await Promise.all([
      edit(suratBuyer, { quantityMetres: 100 }),
      request(app).post(`/api/orders/${order._id}/confirm`).set('Authorization', bearer(admin)).set('Idempotency-Key', newKey()).send({}),
    ]);
    const stored = await Order.findById(order._id).lean();
    if (confirmed.status === 200 && edited.status === 200) {
      // Edit first, then confirm: the confirmation must be based on the edited quantity.
      expect(stored.feasibility.inputs.requiredYarnGrams).toBe(stored.requiredYarnGrams);
    } else {
      expect([edited.status, confirmed.status].sort()).toEqual([200, 409]);
    }
    expect(stored.feasibility === null || stored.feasibility.inputs.requiredYarnGrams === stored.requiredYarnGrams).toBe(true);
  });
});
