import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { InventoryTransaction } from '../../src/models/InventoryTransaction.js';
import { User } from '../../src/models/User.js';
import { YarnLot } from '../../src/models/YarnLot.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { clearInventory, ensureInventoryCollections, newKey, receiptBody } from '../helpers/inventory.js';

let app;
let store;
let lot;

const patch = (actor, body, id = lot.id) => request(app).patch(`/api/yarn-lots/${id}`).set('Authorization', bearer(actor)).send(body);

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await ensureInventoryCollections();
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  store = await createTestUser({ role: ROLES.STORE_KEEPER });
  const res = await request(app).post('/api/yarn-lots').set('Authorization', bearer(store)).set('Idempotency-Key', newKey()).send(receiptBody({ lotNumber: 'GRN-EDIT-0001', yarnCount: '30s' }));
  lot = res.body.data.lot;
});

afterEach(async () => {
  await clearInventory();
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('PATCH /api/yarn-lots/:id (store keeper edits descriptive details)', () => {
  it('updates supplier, count and cost; quantities, ledger and balances are untouched; audited', async () => {
    const res = await patch(store, { expectedUpdatedAt: lot.updatedAt, supplierName: 'Sri Murugan Mills', yarnCount: '40s', costPerKgPaise: 33500 });
    expect(res.status).toBe(200);
    expect(res.body.data.lot).toMatchObject({ supplierName: 'Sri Murugan Mills', yarnCount: '40s', costPerKgPaise: 33500, totalKg: lot.totalKg, reservedKg: 0 });
    expect(await InventoryTransaction.countDocuments({ yarnLotId: lot.id })).toBe(1); // only the receipt
    const audit = await AuditLog.findOne({ action: 'YARN_LOT_UPDATED' }).lean();
    expect(audit).toMatchObject({ actorRole: 'STORE_KEEPER', before: { supplierName: 'Sri Lakshmi Spinners', yarnCount: '30s', costPerKgPaise: 32000 }, after: { supplierName: 'Sri Murugan Mills', yarnCount: '40s', costPerKgPaise: 33500 } });
  });

  it('never accepts quantity fields (stock changes only through the ledger)', async () => {
    for (const field of ['totalGrams', 'reservedGrams', 'quantityKg', 'totalKg']) {
      expect((await patch(store, { expectedUpdatedAt: lot.updatedAt, [field]: 1 })).status).toBe(400);
    }
    expect((await YarnLot.findById(lot.id).lean()).totalGrams).toBe(1_250_000);
  });

  it('refuses a stale copy (someone changed the lot meanwhile)', async () => {
    const first = await patch(store, { expectedUpdatedAt: lot.updatedAt, supplierName: 'First Edit Mills' });
    expect(first.status).toBe(200);
    const stale = await patch(store, { expectedUpdatedAt: lot.updatedAt, supplierName: 'Second Edit Mills' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details).toEqual({ reason: 'STALE_EDIT' });
    expect((await YarnLot.findById(lot.id).lean()).supplierName).toBe('First Edit Mills');
  });

  it('material and colour cannot change once yarn from the lot was reserved', async () => {
    await YarnLot.updateOne({ _id: lot.id }, { $set: { reservedGrams: 1000 } });
    const fresh = await YarnLot.findById(lot.id).lean();
    const res = await patch(store, { expectedUpdatedAt: fresh.updatedAt.toISOString(), colour: 'Red' });
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ reason: 'LOT_IN_USE' });
    // other details still editable
    expect((await patch(store, { expectedUpdatedAt: fresh.updatedAt.toISOString(), supplierName: 'Still Editable Mills' })).status).toBe(200);
  });

  it('keeps lot numbers unique', async () => {
    await request(app).post('/api/yarn-lots').set('Authorization', bearer(store)).set('Idempotency-Key', newKey()).send(receiptBody({ lotNumber: 'GRN-EDIT-0002' }));
    const res = await patch(store, { expectedUpdatedAt: lot.updatedAt, lotNumber: 'GRN-EDIT-0002' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_RESOURCE');
  });

  it('is for the store keeper and the admin only', async () => {
    for (const role of [ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.BUYER]) {
      expect((await patch(await createTestUser({ role }), { expectedUpdatedAt: lot.updatedAt, supplierName: 'Nope Mills' })).status).toBe(403);
    }
    expect((await patch(await createTestUser({ role: ROLES.ADMIN }), { expectedUpdatedAt: lot.updatedAt, supplierName: 'Owner Edit Mills' })).status).toBe(200);
  });
});
