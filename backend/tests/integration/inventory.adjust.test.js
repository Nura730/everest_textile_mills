import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { InventoryTransaction } from '../../src/models/InventoryTransaction.js';
import { User } from '../../src/models/User.js';
import { YarnLot } from '../../src/models/YarnLot.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { clearInventory, counts, ensureInventoryCollections, newKey, receiptBody } from '../helpers/inventory.js';

let app;
let admin;
let lot;

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await ensureInventoryCollections();
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
  const res = await request(app)
    .post('/api/yarn-lots')
    .set('Authorization', bearer(admin))
    .set('Idempotency-Key', newKey())
    .send(receiptBody({ quantityKg: 100 }));
  lot = res.body.data.lot;
});

afterEach(async () => {
  await clearInventory();
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

const adjust = (actor, body, { lotId = lot.id, key = newKey() } = {}) =>
  request(app)
    .post(`/api/yarn-lots/${lotId}/adjustments`)
    .set('Authorization', bearer(actor))
    .set('Idempotency-Key', key)
    .send(body);

describe('POST /api/yarn-lots/:id/adjustments', () => {
  it('reduces stock with a reason and records ledger and audit', async () => {
    const res = await adjust(admin, { deltaKg: -2.5, reason: 'Water damage on two cones' });

    expect(res.status).toBe(201);
    expect(res.body.data.lot).toMatchObject({ totalKg: 97.5, availableKg: 97.5 });
    expect(res.body.data.transaction).toMatchObject({ type: 'ADJUSTMENT', deltaTotalKg: -2.5, reason: 'Water damage on two cones' });

    const audit = await AuditLog.findOne({ action: 'STOCK_ADJUSTED' }).lean();
    expect(audit.before).toEqual({ totalGrams: 100_000, reservedGrams: 0 });
    expect(audit.after).toMatchObject({ totalGrams: 97_500, deltaGrams: -2_500, reason: 'Water damage on two cones' });
    expect(await counts()).toEqual({ lots: 1, ledger: 2, audits: 2, keys: 2 });
  });

  it('increases stock after a recount', async () => {
    const res = await adjust(admin, { deltaKg: 0.75, reason: 'Recount found extra cones' });
    expect(res.body.data.lot.totalKg).toBe(100.75);
  });

  it('allows reducing exactly down to the reserved quantity', async () => {
    await YarnLot.updateOne({ _id: lot.id }, { reservedGrams: 60_000 });
    const res = await adjust(admin, { deltaKg: -40, reason: 'Stock count correction' });

    expect(res.status).toBe(201);
    expect(res.body.data.lot).toMatchObject({ totalKg: 60, reservedKg: 60, availableKg: 0 });
  });

  it('refuses to go below the reserved quantity (409 INSUFFICIENT_STOCK) and writes nothing', async () => {
    await YarnLot.updateOne({ _id: lot.id }, { reservedGrams: 60_000 });
    const res = await adjust(admin, { deltaKg: -40.001, reason: 'Stock count correction' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: { totalKg: 100, reservedKg: 60, maxReductionKg: 40, requestedDeltaKg: -40.001 },
    });
    expect((await YarnLot.findById(lot.id).lean()).totalGrams).toBe(100_000);
    expect(await counts()).toEqual({ lots: 1, ledger: 1, audits: 1, keys: 1 });
  });

  it('refuses to go below zero', async () => {
    const res = await adjust(admin, { deltaKg: -100.001, reason: 'Stock count correction' });
    expect(res.status).toBe(409);
  });

  it('lets only one of two concurrent write-offs through when both cannot fit', async () => {
    const results = await Promise.all([
      adjust(admin, { deltaKg: -60, reason: 'Write-off batch A' }),
      adjust(admin, { deltaKg: -60, reason: 'Write-off batch B' }),
    ]);

    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect((await YarnLot.findById(lot.id).lean()).totalGrams).toBe(40_000);
    expect(await InventoryTransaction.countDocuments({ type: 'ADJUSTMENT' })).toBe(1);
  });

  it('replays a retried adjustment instead of applying it twice', async () => {
    const key = newKey();
    const body = { deltaKg: -10, reason: 'Stock count correction' };
    await adjust(admin, body, { key });
    const retry = await adjust(admin, body, { key });

    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect((await YarnLot.findById(lot.id).lean()).totalGrams).toBe(90_000);
  });

  it('is ADMIN only (a store keeper cannot write off stock)', async () => {
    const keeper = await createTestUser({ role: ROLES.STORE_KEEPER });
    const res = await adjust(keeper, { deltaKg: -10, reason: 'Stock count correction' });

    expect(res.status).toBe(403);
    expect((await YarnLot.findById(lot.id).lean()).totalGrams).toBe(100_000);
  });

  it('returns 404 for an unknown lot', async () => {
    const res = await adjust(admin, { deltaKg: -1, reason: 'Stock count correction' }, { lotId: '64b7f0c2a1b2c3d4e5f60718' });
    expect(res.status).toBe(404);
  });

  it.each([
    ['zero', { deltaKg: 0, reason: 'Stock count correction' }, 'deltaKg'],
    ['4 decimals', { deltaKg: -1.0001, reason: 'Stock count correction' }, 'deltaKg'],
    ['a missing reason', { deltaKg: -1 }, 'reason'],
    ['a too-short reason', { deltaKg: -1, reason: 'oops' }, 'reason'],
    ['an unknown field', { deltaKg: -1, reason: 'Stock count correction', reservedKg: 5 }, ''],
  ])('returns 400 for %s', async (_label, body, path) => {
    const res = await adjust(admin, body);

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
  });
});
