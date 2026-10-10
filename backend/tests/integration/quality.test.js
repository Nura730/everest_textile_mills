import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { Machine } from '../../src/models/Machine.js';
import { ProductionRun } from '../../src/models/ProductionRun.js';
import { QcInspection } from '../../src/models/QcInspection.js';
import { Roll } from '../../src/models/Roll.js';
import { Signature } from '../../src/models/Signature.js';
import { User } from '../../src/models/User.js';
import { YarnLot } from '../../src/models/YarnLot.js';
import { signatureHash } from '../../src/services/signature.service.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { clearCatalog, createTestBuyer, createTestOrder, createTestProduct, ensureCatalogCollections } from '../helpers/catalog.js';
import { clearInventory, ensureInventoryCollections, newKey } from '../helpers/inventory.js';
import { SIGNATURE_PNG, SIGNED } from '../helpers/signature.js';

const signed = SIGNED;

let app;
let admin;
let qc;
let floor;
let store;
let buyerUser;
let order;
let machine;
let run;
let lot;
let rollSeq = 0;

async function newRoll(overrides = {}) {
  rollSeq += 1;
  return Roll.create({
    rollNumber: `ROLL-T-${String(rollSeq).padStart(5, '0')}`, orderId: order._id, orderNumber: order.orderNumber, runId: run._id,
    runNumber: run.runNumber, machineId: machine._id, machineCode: machine.code, yarnLots: [{ yarnLotId: lot._id, lotNumber: lot.lotNumber }],
    lengthCm: 42_000, producedBy: floor._id, ...overrides,
  });
}

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await ensureCatalogCollections();
  await ensureInventoryCollections();
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
  qc = await createTestUser({ role: ROLES.QC_INSPECTOR, name: 'Meena Iyer' });
  floor = await createTestUser({ role: ROLES.FLOOR_MANAGER });
  store = await createTestUser({ role: ROLES.STORE_KEEPER });
  const buyerCo = await createTestBuyer();
  buyerUser = await createTestUser({ role: ROLES.BUYER, buyerId: buyerCo._id });
  order = await createTestOrder({ buyer: buyerCo, product: await createTestProduct(), createdBy: admin._id, status: 'IN_PRODUCTION' });
  machine = await Machine.create({ code: 'W-03', name: 'Loom 3', type: 'WEAVING', ratedCmPerHour: 2500, status: 'RUNNING' });
  run = await ProductionRun.create({ runNumber: 'RUN-T-0001', orderId: order._id, orderNumber: order.orderNumber, machineId: machine._id, machineCode: 'W-03', targetCm: 500_000, status: 'RUNNING', supervisorId: floor._id });
  lot = await YarnLot.create({ lotNumber: 'GRN-QC-1', material: 'COTTON', colour: 'Navy', supplierName: 'Sri Lakshmi Spinners', costPerKgPaise: 1, receivedAt: new Date(), receivedBy: admin._id, totalGrams: 1000 });
});

afterEach(async () => {
  await clearCatalog();
  await clearInventory();
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

const inspect = (roll, body, actor = qc, key = newKey()) =>
  request(app).post(`/api/rolls/${roll._id}/inspections`).set('Authorization', bearer(actor)).set('Idempotency-Key', key).send(body);
const reworkDone = (roll, actor = floor) =>
  request(app).post(`/api/rolls/${roll._id}/rework-done`).set('Authorization', bearer(actor)).set('Idempotency-Key', newKey()).send({ note: 'Re-dyed' });
const get = (actor, path) => request(app).get(path).set('Authorization', bearer(actor));
const colourMismatch = [{ type: 'COLOUR_MISMATCH', severity: 'MAJOR', notes: 'Shade darker than standard' }];

describe('roll traceability', () => {
  it('answers which order, run, machine, when, how much and which yarn — from the roll id', async () => {
    const roll = await newRoll();
    const res = await get(store, `/api/rolls/${roll._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      roll: { rollNumber: roll.rollNumber, lengthMetres: 420, status: 'QC_PENDING', producedAt: expect.any(String) },
      order: { orderNumber: order.orderNumber, product: { material: 'COTTON', colour: 'Navy' } },
      run: { runNumber: 'RUN-T-0001' },
      machine: { code: 'W-03' },
      yarnLots: [{ lotNumber: 'GRN-QC-1', supplierName: 'Sri Lakshmi Spinners' }],
      inspections: [],
    });
  });

  it('lists rolls with filters and search; the QC queue is oldest first; buyers cannot see rolls', async () => {
    const first = await newRoll({ producedAt: new Date(Date.now() - 60_000) });
    await newRoll();
    await newRoll({ status: 'REJECTED' });
    const queue = (await get(qc, '/api/rolls?status=QC_PENDING')).body.data.rolls.map((r) => r.rollNumber);
    expect(queue[0]).toBe(first.rollNumber);
    expect(queue).toHaveLength(2);
    expect((await get(qc, `/api/rolls?q=${first.rollNumber}`)).body.meta.total).toBe(1);
    expect((await get(qc, `/api/rolls?machineId=${machine._id}`)).body.meta.total).toBe(3);
    expect((await get(buyerUser, '/api/rolls')).status).toBe(403);
  });
});

describe('QC inspection', () => {
  it('PASS needs the inspector\'s signature, which is stored with its statement and a verifiable hash', async () => {
    const roll = await newRoll();
    const unsigned = await inspect(roll, { result: 'PASS' });
    expect(unsigned.status).toBe(400);
    expect(unsigned.body.error).toMatchObject({ code: 'SIGNATURE_REQUIRED', details: { statement: `I confirm that roll ${roll.rollNumber} has passed inspection.` } });

    const res = await inspect(roll, { result: 'PASS', notes: 'Clean roll', signature: signed });
    expect(res.status).toBe(201);
    expect(res.body.data.roll.status).toBe('QC_PASSED');
    expect(res.body.data.inspection).toMatchObject({ attempt: 1, result: 'PASS', inspectorName: 'Meena Iyer', signatureId: expect.any(String) });
    const sig = await Signature.findOne({ entityId: roll._id }).lean();
    expect(sig).toMatchObject({ entityType: 'QC_INSPECTION', signerName: 'Meena Iyer', signerRole: 'QC_INSPECTOR', statement: `I confirm that roll ${roll.rollNumber} has passed inspection.` });
    const record = { rollNumber: roll.rollNumber, lengthCm: 42_000, attempt: 1, result: 'PASS', inspectionId: res.body.data.inspection.id };
    expect(sig.contentHash).toBe(signatureHash({ statement: sig.statement, signerId: qc._id, record }));
    expect(await AuditLog.countDocuments({ action: 'QC_PASSED', entityId: roll._id })).toBe(1);
  });

  it('REWORK and REJECT need at least one defect', async () => {
    const roll = await newRoll();
    for (const result of ['REWORK', 'REJECT']) {
      const res = await inspect(roll, { result });
      expect(res.status).toBe(400);
      expect(res.body.error.details[0].path).toBe('defects');
    }
  });

  it('REWORK keeps the roll in history: inspected again as attempt 2 after rework', async () => {
    const roll = await newRoll();
    expect((await inspect(roll, { result: 'REWORK', defects: colourMismatch })).body.data.roll.status).toBe('IN_REWORK');
    expect((await inspect(roll, { result: 'PASS', signature: signed })).body.error.code).toBe('INVALID_STATE_TRANSITION');
    const back = await reworkDone(roll);
    expect(back.body.data.roll).toMatchObject({ status: 'QC_PENDING', reworkCount: 1 });
    const second = await inspect(roll, { result: 'PASS', signature: signed });
    expect(second.body.data.inspection.attempt).toBe(2);
    const trace = (await get(qc, `/api/rolls/${roll._id}`)).body.data;
    expect(trace.inspections.map((i) => [i.attempt, i.result])).toEqual([[1, 'REWORK'], [2, 'PASS']]);
    expect(trace.inspections[0].defects[0]).toMatchObject({ type: 'COLOUR_MISMATCH', severity: 'MAJOR' });
    expect(trace.qcSignature).toMatchObject({ signerName: 'Meena Iyer', signatureImage: SIGNATURE_PNG });
  });

  it('REJECT is terminal: the roll can never be inspected or reworked again', async () => {
    const roll = await newRoll();
    expect((await inspect(roll, { result: 'REJECT', defects: [{ type: 'HOLES', severity: 'CRITICAL' }] })).body.data.roll.status).toBe('REJECTED');
    expect((await inspect(roll, { result: 'PASS', signature: signed })).status).toBe(409);
    expect((await reworkDone(roll)).status).toBe(409);
  });

  it('inspection history is append-only', async () => {
    const roll = await newRoll();
    await inspect(roll, { result: 'REJECT', defects: colourMismatch });
    await expect(QcInspection.updateOne({}, { $set: { result: 'PASS' } })).rejects.toThrow(/append-only/);
    await expect(Signature.deleteMany({})).rejects.toThrow(/append-only/);
  });

  it('two inspectors inspecting the same roll at once: exactly one result is recorded', async () => {
    const roll = await newRoll();
    const results = await Promise.all([
      inspect(roll, { result: 'PASS', signature: signed }),
      inspect(roll, { result: 'REJECT', defects: colourMismatch }, await createTestUser({ role: ROLES.QC_INSPECTOR })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await QcInspection.countDocuments({ rollId: roll._id })).toBe(1);
  });

  it('replays a retried inspection instead of recording it twice', async () => {
    const roll = await newRoll();
    const key = newKey();
    await inspect(roll, { result: 'REJECT', defects: colourMismatch }, qc, key);
    const retry = await inspect(roll, { result: 'REJECT', defects: colourMismatch }, qc, key);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(await QcInspection.countDocuments({ rollId: roll._id })).toBe(1);
  });

  it.each([
    ['an unknown result', { result: 'MAYBE' }],
    ['an unknown defect', { result: 'REJECT', defects: [{ type: 'GHOSTS', severity: 'MAJOR' }] }],
    ['a non-PNG signature', { result: 'PASS', signature: { accepted: true, image: 'data:image/jpeg;base64,AAAA' } }],
    ['an unaccepted statement', { result: 'PASS', signature: { accepted: false, image: SIGNATURE_PNG } }],
  ])('rejects %s (400)', async (_label, body) => {
    expect((await inspect(await newRoll(), body)).status).toBe(400);
  });

  it('only QC (and admin) inspect; only the floor (and admin) finish rework', async () => {
    const roll = await newRoll();
    for (const actor of [floor, store]) expect((await inspect(roll, { result: 'REJECT', defects: colourMismatch }, actor)).status).toBe(403);
    expect((await reworkDone(roll, qc)).status).toBe(403);
  });
});

describe('QC reports', () => {
  it('summarises rolls by status and inspections by result, and lists inspections by result', async () => {
    const a = await newRoll();
    const b = await newRoll();
    await inspect(a, { result: 'PASS', signature: signed });
    await inspect(b, { result: 'REWORK', defects: colourMismatch });
    const summary = (await get(qc, '/api/qc/summary')).body.data;
    expect(summary.inspections).toMatchObject({ PASS: 1, REWORK: 1 });
    expect(summary.rolls.IN_REWORK).toMatchObject({ rolls: 1, metres: 420 });
    expect((await get(floor, '/api/qc/inspections?result=REWORK')).body.meta.total).toBe(1);
    expect((await get(store, '/api/qc/summary')).status).toBe(403);
  });
});
