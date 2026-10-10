import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { InventoryTransaction } from '../../src/models/InventoryTransaction.js';
import { Machine } from '../../src/models/Machine.js';
import { ProductionRun } from '../../src/models/ProductionRun.js';
import { Roll } from '../../src/models/Roll.js';
import { SyncEvent } from '../../src/models/SyncEvent.js';
import { User } from '../../src/models/User.js';
import { YarnLot } from '../../src/models/YarnLot.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { clearCatalog, createTestBuyer, createTestOrder, createTestProduct, ensureCatalogCollections } from '../helpers/catalog.js';
import { clearInventory, ensureInventoryCollections, newKey } from '../helpers/inventory.js';
import { SIGNED } from '../helpers/signature.js';

let app;
let admin;
let floor;
let qc;
let store;
let loom;
let run; // RUNNING on loom, 850 kg issued

const DEVICE = 'tablet-floor-01';
const post = (actor, path, body = {}) => request(app).post(path).set('Authorization', bearer(actor)).set('Idempotency-Key', newKey()).send(body);
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();
const event = (type, payload, recordedAt = minutesAgo(5)) => ({ eventId: randomUUID(), type, payload, recordedAt });
const sync = (actor, events, deviceId = DEVICE) => request(app).post('/api/sync/events').set('Authorization', bearer(actor)).send({ deviceId, events });

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await ensureCatalogCollections();
  await ensureInventoryCollections();
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
  floor = await createTestUser({ role: ROLES.FLOOR_MANAGER });
  qc = await createTestUser({ role: ROLES.QC_INSPECTOR });
  store = await createTestUser({ role: ROLES.STORE_KEEPER });
  loom = await Machine.create({ code: 'W-S1', name: 'Loom', type: 'WEAVING', ratedCmPerHour: 1500 });
  const lot = await YarnLot.create({ lotNumber: 'GRN-SYNC', material: 'COTTON', colour: 'Navy', supplierName: 'S', costPerKgPaise: 1, receivedAt: new Date(Date.now() - 86_400_000), receivedBy: admin._id, totalGrams: 2_000_000 });
  await InventoryTransaction.create({ type: 'RECEIPT', yarnLotId: lot._id, deltaTotalGrams: 2_000_000, deltaReservedGrams: 0, actorId: admin._id });
  const order = await createTestOrder({ buyer: await createTestBuyer(), product: await createTestProduct(), createdBy: admin._id, status: 'CONFIRMED', quantityCm: 500_000, requiredYarnGrams: 850_000 });
  expect((await post(store, `/api/orders/${order._id}/reserve`)).status).toBe(200);
  expect((await post(store, `/api/orders/${order._id}/issue`, { quantityKg: 850 })).status).toBe(200);
  const planned = await post(floor, '/api/production-runs', { orderId: String(order._id), machineId: String(loom._id), targetMetres: 5000 });
  run = planned.body.data.run;
  expect((await post(floor, `/api/production-runs/${run.id}/start`)).status).toBe(200);
});

afterEach(async () => {
  await clearCatalog();
  await clearInventory();
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('POST /api/sync/events', () => {
  it('replays a shift of offline work in the order it happened, through the normal rules', async () => {
    const res = await sync(floor, [
      // Sent out of order on purpose: the server sorts by recordedAt.
      event('RUN_RESUME', { runId: run.id }, minutesAgo(20)),
      event('ROLL_RECORD', { runId: run.id, lengthMetres: 1200 }, minutesAgo(40)),
      event('RUN_PAUSE', { runId: run.id, reason: 'Yarn break on the creel' }, minutesAgo(30)),
    ]);
    expect(res.status).toBe(200);
    expect(res.body.data.results.map((r) => [r.type, r.outcome])).toEqual([['ROLL_RECORD', 'APPLIED'], ['RUN_PAUSE', 'APPLIED'], ['RUN_RESUME', 'APPLIED']]);
    expect(res.body.data.counts).toMatchObject({ APPLIED: 3, CONFLICT: 0 });
    expect(await ProductionRun.findById(run.id).lean()).toMatchObject({ status: 'RUNNING', producedCm: 120_000 });
    // Audit entries say the action came from an offline device.
    expect(await AuditLog.countDocuments({ action: 'ROLL_RECORDED', source: 'OFFLINE' })).toBe(1);
    expect(await SyncEvent.countDocuments({ deviceId: DEVICE, outcome: 'APPLIED' })).toBe(3);
  });

  it('applies an event at most once: resending returns DUPLICATE with the original outcome', async () => {
    const recorded = event('ROLL_RECORD', { runId: run.id, lengthMetres: 800 });
    expect((await sync(floor, [recorded])).body.data.results[0].outcome).toBe('APPLIED');
    const again = await sync(floor, [recorded]);
    expect(again.body.data.results[0]).toMatchObject({ outcome: 'DUPLICATE', originalOutcome: 'APPLIED' });
    expect(await Roll.countDocuments({ runId: run.id })).toBe(1);
    // Two devices racing with the same event still produce one roll.
    const raced = event('ROLL_RECORD', { runId: run.id, lengthMetres: 500 });
    await Promise.all([sync(floor, [raced]), sync(floor, [raced])]);
    expect(await Roll.countDocuments({ runId: run.id })).toBe(2);
  });

  it('reports CONFLICT when the factory moved on while the device was offline', async () => {
    expect((await post(floor, `/api/production-runs/${run.id}/complete`, {})).status).toBe(409); // nothing produced yet
    await sync(floor, [event('ROLL_RECORD', { runId: run.id, lengthMetres: 100 })]);
    expect((await post(floor, `/api/production-runs/${run.id}/complete`, {})).status).toBe(200);
    const res = await sync(floor, [event('RUN_PAUSE', { runId: run.id, reason: 'Pause recorded offline' })]);
    expect(res.body.data.results[0]).toMatchObject({ outcome: 'CONFLICT', error: { code: 'INVALID_STATE_TRANSITION' } });
    // Conflicts stay visible for review.
    const list = await request(app).get('/api/sync/events?outcome=CONFLICT').set('Authorization', bearer(floor));
    expect(list.body.data.events).toHaveLength(1);
  });

  it('REJECTS what can never succeed: bad data, a role that may not do it, an unknown record', async () => {
    const res = await sync(floor, [
      event('ROLL_RECORD', { runId: run.id, lengthMetres: -5 }),
      event('QC_INSPECT', { rollId: run.id, result: 'PASS', signature: SIGNED }),
      event('RUN_PAUSE', { runId: '0123456789abcdef01234567', reason: 'Unknown run here' }),
    ]);
    expect(res.body.data.results.map((r) => [r.outcome, r.error.code])).toEqual([['REJECTED', 'VALIDATION_ERROR'], ['REJECTED', 'FORBIDDEN'], ['REJECTED', 'NOT_FOUND']]);
  });

  it('QC inspections can be captured offline with the signature', async () => {
    const recorded = await sync(floor, [event('ROLL_RECORD', { runId: run.id, lengthMetres: 300 })]);
    const rollId = recorded.body.data.results[0].result.roll.id;
    const res = await sync(qc, [event('QC_INSPECT', { rollId, result: 'PASS', signature: SIGNED })], 'tablet-qc-0001');
    expect(res.body.data.results[0].outcome).toBe('APPLIED');
    expect(await Roll.findById(rollId).lean()).toMatchObject({ status: 'FINISHED' });
  });

  it('validates the batch and limits it to floor, QC and admin', async () => {
    expect((await sync(store, [event('RUN_RESUME', { runId: run.id })])).status).toBe(403);
    expect((await sync(floor, [{ ...event('RUN_RESUME', { runId: run.id }), eventId: 'not-a-uuid' }])).status).toBe(400);
    expect((await sync(floor, [event('DELETE_EVERYTHING', {})])).status).toBe(400);
    const same = event('RUN_RESUME', { runId: run.id });
    expect((await sync(floor, [same, same])).status).toBe(400);
    // Another user's eventId cannot be reused or read back.
    const mine = event('ROLL_RECORD', { runId: run.id, lengthMetres: 10 });
    await sync(floor, [mine]);
    expect((await sync(admin, [mine])).body.data.results[0]).toMatchObject({ outcome: 'REJECTED' });
  });
});
