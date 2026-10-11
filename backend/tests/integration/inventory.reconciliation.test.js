import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { InventoryTransaction } from '../../src/models/InventoryTransaction.js';
import { User } from '../../src/models/User.js';
import { YarnLot } from '../../src/models/YarnLot.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { clearInventory, ensureInventoryCollections, newKey, receiptBody } from '../helpers/inventory.js';

let app;
let admin;

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await ensureInventoryCollections();
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
});

afterEach(async () => {
  await clearInventory();
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

const post = (path, body) =>
  request(app).post(path).set('Authorization', bearer(admin)).set('Idempotency-Key', newKey()).send(body);
const report = (actor = admin) => request(app).get('/api/inventory/reconciliation').set('Authorization', bearer(actor));

async function receive(overrides) {
  return (await post('/api/yarn-lots', receiptBody(overrides))).body.data.lot;
}

describe('GET /api/inventory/reconciliation', () => {
  it('reports balanced after receipts and adjustments made through the API', async () => {
    const lot = await receive({ quantityKg: 100 });
    await receive({ quantityKg: 250.5 });
    await post(`/api/yarn-lots/${lot.id}/adjustments`, { deltaKg: -2.25, reason: 'Water damage on cones' });
    await post(`/api/yarn-lots/${lot.id}/adjustments`, { deltaKg: 0.5, reason: 'Recount found cones' });

    const res = await report();

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ lotsChecked: 2, balanced: true, mismatches: [] });
  });

  it('detects a balance changed without a ledger entry', async () => {
    const lot = await receive({ quantityKg: 100 });
    // Someone edits the database directly, bypassing the service and the ledger.
    await YarnLot.updateOne({ _id: lot.id }, { $inc: { totalGrams: 5_000 } });

    const res = await report();

    expect(res.body.data.balanced).toBe(false);
    expect(res.body.data.mismatches).toEqual([
      {
        lotId: lot.id,
        lotNumber: lot.lotNumber,
        issues: ['TOTAL_MISMATCH'],
        stored: { totalKg: 105, reservedKg: 0 },
        ledger: { totalKg: 100, reservedKg: 0, entries: 1 },
      },
    ]);
  });

  it('detects a broken invariant (reserved > total)', async () => {
    const lot = await receive({ quantityKg: 10 });
    await YarnLot.updateOne({ _id: lot.id }, { reservedGrams: 20_000 });

    const [mismatch] = (await report()).body.data.mismatches;
    expect(mismatch.issues).toEqual(['RESERVED_MISMATCH', 'INVARIANT_VIOLATED']);
  });

  it('detects ledger rows that point at a missing lot', async () => {
    const orphanLotId = new mongoose.Types.ObjectId();
    await InventoryTransaction.create({
      type: 'RECEIPT',
      yarnLotId: orphanLotId,
      deltaTotalGrams: 1_000,
      deltaReservedGrams: 0,
      actorId: admin._id,
    });

    const [mismatch] = (await report()).body.data.mismatches;
    expect(mismatch).toMatchObject({ lotId: String(orphanLotId), lotNumber: null, issues: ['LEDGER_WITHOUT_LOT'] });
  });

  it('the store keeper (who corrects stock) and the admin can run it; the floor cannot', async () => {
    const keeper = await createTestUser({ role: ROLES.STORE_KEEPER });
    expect((await report(keeper)).status).toBe(200);
    const floor = await createTestUser({ role: ROLES.FLOOR_MANAGER });
    expect((await report(floor)).status).toBe(403);
  });
});
