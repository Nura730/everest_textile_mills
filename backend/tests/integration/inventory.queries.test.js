import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { User } from '../../src/models/User.js';
import { YarnLot } from '../../src/models/YarnLot.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { clearInventory, ensureInventoryCollections, newKey, receiptBody } from '../helpers/inventory.js';

let app;
let keeper;
let floor;

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await ensureInventoryCollections();
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  keeper = await createTestUser({ role: ROLES.STORE_KEEPER });
  floor = await createTestUser({ role: ROLES.FLOOR_MANAGER });
});

afterEach(async () => {
  await clearInventory();
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

async function receive(body) {
  const res = await request(app)
    .post('/api/yarn-lots')
    .set('Authorization', bearer(keeper))
    .set('Idempotency-Key', newKey())
    .send(receiptBody(body));
  expect(res.status).toBe(201);
  return res.body.data.lot;
}

const get = (actor, path) => request(app).get(path).set('Authorization', bearer(actor));

describe('GET /api/yarn-lots', () => {
  it('lists lots oldest first with pagination meta', async () => {
    await receive({ lotNumber: 'NEWER', receivedAt: '2026-10-05T00:00:00Z' });
    await receive({ lotNumber: 'OLDER', receivedAt: '2026-09-01T00:00:00Z' });

    const res = await get(keeper, '/api/yarn-lots');

    expect(res.status).toBe(200);
    expect(res.body.data.lots.map((lot) => lot.lotNumber)).toEqual(['OLDER', 'NEWER']);
    expect(res.body.meta).toEqual({ page: 1, limit: 50, total: 2 });
  });

  it('filters by material and colour (colour normalised)', async () => {
    await receive({ colour: 'Navy' });
    await receive({ colour: 'Red' });
    await receive({ material: 'POLYESTER', colour: 'Navy' });

    const res = await get(keeper, '/api/yarn-lots?material=COTTON&colour=navy');
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data.lots[0]).toMatchObject({ material: 'COTTON', colour: 'Navy' });
  });

  it('hides depleted lots unless asked', async () => {
    const lot = await receive();
    await YarnLot.updateOne({ _id: lot.id }, { totalGrams: 0 });

    expect((await get(keeper, '/api/yarn-lots')).body.meta.total).toBe(0);
    expect((await get(keeper, '/api/yarn-lots?includeDepleted=true')).body.meta.total).toBe(1);
  });

  it('shows cost to the store keeper but not to the floor manager', async () => {
    await receive();

    const forKeeper = await get(keeper, '/api/yarn-lots');
    const forFloor = await get(floor, '/api/yarn-lots');

    expect(forKeeper.body.data.lots[0].costPerKgPaise).toBe(32000);
    expect(forFloor.status).toBe(200);
    expect(forFloor.body.data.lots[0]).not.toHaveProperty('costPerKgPaise');
  });

  it.each([ROLES.QC_INSPECTOR, ROLES.BUYER])('returns 403 for %s', async (role) => {
    const actor = await createTestUser({ role });
    expect((await get(actor, '/api/yarn-lots')).status).toBe(403);
  });

  it.each(['material=JUTE', 'limit=0', 'includeDepleted=maybe'])('returns 400 for ?%s', async (query) => {
    expect((await get(keeper, `/api/yarn-lots?${query}`)).status).toBe(400);
  });
});

describe('GET /api/yarn-lots/:id', () => {
  it('returns one lot with total, reserved and available', async () => {
    const lot = await receive({ quantityKg: 1250 });
    await YarnLot.updateOne({ _id: lot.id }, { reservedGrams: 850_000 });

    const res = await get(keeper, `/api/yarn-lots/${lot.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.lot).toMatchObject({ id: lot.id, totalKg: 1250, reservedKg: 850, availableKg: 400 });
  });

  it('hides cost from the floor manager', async () => {
    const lot = await receive();
    const res = await get(floor, `/api/yarn-lots/${lot.id}`);
    expect(res.body.data.lot).not.toHaveProperty('costPerKgPaise');
  });

  it('returns 404 for an unknown lot and 400 for a malformed id', async () => {
    expect((await get(keeper, '/api/yarn-lots/64b7f0c2a1b2c3d4e5f60718')).status).toBe(404);
    expect((await get(keeper, '/api/yarn-lots/not-an-id')).status).toBe(400);
  });
});

describe('GET /api/yarn-lots/:id/transactions', () => {
  it('returns the ledger newest first', async () => {
    const lot = await receive({ quantityKg: 500 });
    const res = await get(keeper, `/api/yarn-lots/${lot.id}/transactions`);

    expect(res.status).toBe(200);
    expect(res.body.data.transactions).toEqual([
      expect.objectContaining({ type: 'RECEIPT', deltaTotalKg: 500, deltaReservedKg: 0, yarnLotId: lot.id }),
    ]);
    expect(res.body.meta).toEqual({ page: 1, limit: 50, total: 1 });
  });

  it('returns 404 for an unknown lot', async () => {
    expect((await get(keeper, '/api/yarn-lots/64b7f0c2a1b2c3d4e5f60718/transactions')).status).toBe(404);
  });
});

describe('GET /api/inventory/yarn-summary', () => {
  it('groups stock by material and colour across lots', async () => {
    const navyA = await receive({ colour: 'Navy', quantityKg: 1000 });
    await receive({ colour: 'navy', quantityKg: 250 });
    await receive({ colour: 'Red', quantityKg: 40.5 });
    await YarnLot.updateOne({ _id: navyA.id }, { reservedGrams: 850_000 });

    const res = await get(keeper, '/api/inventory/yarn-summary');

    expect(res.status).toBe(200);
    expect(res.body.data.summary).toEqual([
      { material: 'COTTON', colour: 'Navy', lots: 2, totalKg: 1250, reservedKg: 850, availableKg: 400, oldestReceivedAt: expect.any(String) },
      { material: 'COTTON', colour: 'Red', lots: 1, totalKg: 40.5, reservedKg: 0, availableKg: 40.5, oldestReceivedAt: expect.any(String) },
    ]);
  });

  it('filters by material and is visible to the floor manager', async () => {
    await receive({ material: 'POLYESTER' });
    await receive({ material: 'COTTON' });

    const res = await get(floor, '/api/inventory/yarn-summary?material=POLYESTER');
    expect(res.status).toBe(200);
    expect(res.body.data.summary).toHaveLength(1);
  });

  it('returns 403 for a buyer', async () => {
    const buyer = await createTestUser({ role: ROLES.BUYER });
    expect((await get(buyer, '/api/inventory/yarn-summary')).status).toBe(403);
  });
});
