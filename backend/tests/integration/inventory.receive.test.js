import { jest } from '@jest/globals';
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
let keeper;

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await ensureInventoryCollections();
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  keeper = await createTestUser({ role: ROLES.STORE_KEEPER });
});

afterEach(async () => {
  await clearInventory();
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

function receive(actor, body, key = newKey()) {
  let req = request(app).post('/api/yarn-lots').send(body);
  if (actor) req = req.set('Authorization', bearer(actor));
  if (key) req = req.set('Idempotency-Key', key);
  return req;
}

describe('POST /api/yarn-lots — happy path', () => {
  it('creates the lot and returns it with computed availability', async () => {
    const res = await receive(keeper, receiptBody({ lotNumber: 'GRN-2026-0104', quantityKg: 1250.125 }));

    expect(res.status).toBe(201);
    expect(res.headers).not.toHaveProperty('idempotent-replayed');
    expect(res.body.data.lot).toEqual({
      id: expect.any(String),
      lotNumber: 'GRN-2026-0104',
      material: 'COTTON',
      colour: 'Navy',
      yarnCount: null,
      supplierName: 'Sri Lakshmi Spinners',
      totalKg: 1250.125,
      reservedKg: 0,
      availableKg: 1250.125,
      costPerKgPaise: 32000,
      receivedAt: expect.any(String),
      receivedBy: String(keeper._id),
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect((await YarnLot.findOne().lean()).totalGrams).toBe(1_250_125);
  });

  it('writes the RECEIPT ledger row, the audit entry and the idempotency record with it', async () => {
    const key = newKey();
    const res = await receive(keeper, receiptBody(), key);
    const lotId = res.body.data.lot.id;

    const [ledger] = await InventoryTransaction.find().lean();
    expect(ledger).toMatchObject({ type: 'RECEIPT', deltaTotalGrams: 1_250_000, deltaReservedGrams: 0, idempotencyKey: key });
    expect(String(ledger.yarnLotId)).toBe(lotId);

    const [audit] = await AuditLog.find().lean();
    expect(audit).toMatchObject({
      action: 'MATERIAL_RECEIVED',
      actorRole: 'STORE_KEEPER',
      entityType: 'YarnLot',
      idempotencyKey: key,
      requestId: res.headers['x-request-id'],
      after: expect.objectContaining({ totalGrams: 1_250_000 }),
    });
    expect(String(audit.entityId)).toBe(lotId);
    expect(await counts()).toEqual({ lots: 1, ledger: 1, audits: 1, keys: 1 });
  });

  it('normalises colour and lot number', async () => {
    const res = await receive(keeper, receiptBody({ colour: '  navy   BLUE ', lotNumber: ' grn-2026/77 ' }));

    expect(res.body.data.lot).toMatchObject({ colour: 'Navy Blue', lotNumber: 'GRN-2026/77' });
  });

  it('accepts an explicit past receipt time', async () => {
    const res = await receive(keeper, receiptBody({ receivedAt: '2026-10-01T09:30:00+05:30' }));
    expect(res.body.data.lot.receivedAt).toBe('2026-10-01T04:00:00.000Z');
  });
});

describe('POST /api/yarn-lots — permissions', () => {
  it('returns 401 without a token', async () => {
    expect((await receive(null, receiptBody())).status).toBe(401);
  });

  it('allows ADMIN', async () => {
    const admin = await createTestUser({ role: ROLES.ADMIN });
    expect((await receive(admin, receiptBody())).status).toBe(201);
  });

  it.each([ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.BUYER])('returns 403 for %s', async (role) => {
    const actor = await createTestUser({ role });
    const res = await receive(actor, receiptBody());

    expect(res.status).toBe(403);
    expect(await counts()).toEqual({ lots: 0, ledger: 0, audits: 0, keys: 0 });
  });
});

describe('POST /api/yarn-lots — idempotency', () => {
  it('returns 400 when the Idempotency-Key header is missing', async () => {
    const res = await receive(keeper, receiptBody(), null);

    expect(res.status).toBe(400);
    expect(res.body.error.details[0]).toMatchObject({ location: 'headers', path: 'Idempotency-Key' });
    expect(await counts()).toEqual({ lots: 0, ledger: 0, audits: 0, keys: 0 });
  });

  it('replays a retried request without receiving the yarn twice', async () => {
    const key = newKey();
    const body = receiptBody();
    const first = await receive(keeper, body, key);
    const retry = await receive(keeper, body, key);

    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body).toEqual(first.body);
    expect(await counts()).toEqual({ lots: 1, ledger: 1, audits: 1, keys: 1 });
  });

  it('receives exactly once when the same request arrives three times at once', async () => {
    const key = newKey();
    const body = receiptBody();
    const results = await Promise.all([receive(keeper, body, key), receive(keeper, body, key), receive(keeper, body, key)]);

    expect(results.map((res) => res.status)).toEqual([201, 201, 201]);
    expect(results.filter((res) => res.headers['idempotent-replayed'] === 'true')).toHaveLength(2);
    expect(await counts()).toEqual({ lots: 1, ledger: 1, audits: 1, keys: 1 });
  });

  it('returns 409 IDEMPOTENCY_KEY_REUSED when a key is reused for a different receipt', async () => {
    const key = newKey();
    await receive(keeper, receiptBody({ lotNumber: 'GRN-A' }), key);
    const res = await receive(keeper, receiptBody({ lotNumber: 'GRN-B' }), key);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await counts()).toEqual({ lots: 1, ledger: 1, audits: 1, keys: 1 });
  });
});

describe('POST /api/yarn-lots — conflicts and atomicity', () => {
  it('returns 409 DUPLICATE_RESOURCE for an existing lot number and writes nothing', async () => {
    await receive(keeper, receiptBody({ lotNumber: 'GRN-DUP' }));
    const res = await receive(keeper, receiptBody({ lotNumber: 'grn-dup' }));

    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'DUPLICATE_RESOURCE', details: { fields: ['lotNumber'] } });
    expect(await counts()).toEqual({ lots: 1, ledger: 1, audits: 1, keys: 1 });
  });

  it('persists nothing if any step fails, and the same key can then succeed', async () => {
    const key = newKey();
    const body = receiptBody();
    const auditSpy = jest.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('simulated disk failure'));

    const failed = await receive(keeper, body, key);
    expect(failed.status).toBe(500);
    expect(failed.body.error.code).toBe('INTERNAL_ERROR');
    expect(await counts()).toEqual({ lots: 0, ledger: 0, audits: 0, keys: 0 });

    auditSpy.mockRestore();
    const retry = await receive(keeper, body, key);
    expect(retry.status).toBe(201);
    expect(retry.headers).not.toHaveProperty('idempotent-replayed');
    expect(await counts()).toEqual({ lots: 1, ledger: 1, audits: 1, keys: 1 });
  });
});

describe('POST /api/yarn-lots — validation', () => {
  it.each([
    ['zero quantity', { quantityKg: 0 }, 'quantityKg'],
    ['negative quantity', { quantityKg: -5 }, 'quantityKg'],
    ['quantity over 100,000 kg', { quantityKg: 100_000.001 }, 'quantityKg'],
    ['more than 3 decimals', { quantityKg: 10.1234 }, 'quantityKg'],
    ['quantity as a string', { quantityKg: '850' }, 'quantityKg'],
    ['fractional paise', { costPerKgPaise: 320.5 }, 'costPerKgPaise'],
    ['negative cost', { costPerKgPaise: -1 }, 'costPerKgPaise'],
    ['unknown material', { material: 'JUTE' }, 'material'],
    ['colour with digits', { colour: 'Navy 2' }, 'colour'],
    ['lot number with spaces only', { lotNumber: '   ' }, 'lotNumber'],
    ['future receipt time', { receivedAt: '2999-01-01T00:00:00Z' }, 'receivedAt'],
    ['non-ISO receipt time', { receivedAt: '01/10/2026' }, 'receivedAt'],
    ['unknown field', { reservedKg: 100 }, ''],
  ])('returns 400 for %s', async (_label, overrides, path) => {
    const res = await receive(keeper, receiptBody(overrides));

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
    expect(await counts()).toEqual({ lots: 0, ledger: 0, audits: 0, keys: 0 });
  });

  it('accepts the 100,000 kg boundary and 3 decimals', async () => {
    expect((await receive(keeper, receiptBody({ quantityKg: 100_000 }))).status).toBe(201);
    expect((await receive(keeper, receiptBody({ quantityKg: 0.001 }))).status).toBe(201);
  });
});
