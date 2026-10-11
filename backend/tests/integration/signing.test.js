import { generateKeyPairSync } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { Dispatch, FinishedGood } from '../../src/models/Fulfilment.js';
import { Machine } from '../../src/models/Machine.js';
import { ProductionRun } from '../../src/models/ProductionRun.js';
import { QcInspection } from '../../src/models/QcInspection.js';
import { Roll } from '../../src/models/Roll.js';
import { Signature } from '../../src/models/Signature.js';
import { SigningKey } from '../../src/models/SigningKey.js';
import { User } from '../../src/models/User.js';
import { canonicalJson } from '../../src/services/idempotency.service.js';
import { signPayload, verifyPayload } from '../../src/services/signing.service.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { clearCatalog, createTestBuyer, createTestOrder, createTestProduct, ensureCatalogCollections } from '../helpers/catalog.js';
import { clearInventory, ensureInventoryCollections, newKey } from '../helpers/inventory.js';
import { SIGNED } from '../helpers/signature.js';

let app;
let admin;
let qc;
let store;
let floor;
let buyerUser;
let order;
let run;
let machine;
let seq = 0;

const post = (actor, path, body = {}, key = newKey()) => request(app).post(path).set('Authorization', bearer(actor)).set('Idempotency-Key', key).send(body);
const get = (actor, path) => request(app).get(path).set('Authorization', bearer(actor));
const verifyApi = (actor, id) => get(actor, `/api/signatures/${id}/verify`);

async function newRoll(lengthCm = 250_000) {
  seq += 1;
  return Roll.create({
    rollNumber: `ROLL-S-${String(seq).padStart(5, '0')}`, orderId: order._id, orderNumber: order.orderNumber, runId: run._id, runNumber: run.runNumber,
    machineId: machine._id, machineCode: machine.code, lengthCm, producedBy: admin._id,
  });
}
const inspect = (roll, body, actor = qc, key) => post(actor, `/api/rolls/${roll._id}/inspections`, body, key);

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await ensureCatalogCollections();
  await ensureInventoryCollections();
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
  qc = await createTestUser({ role: ROLES.QC_INSPECTOR, name: 'Meena QC' });
  store = await createTestUser({ role: ROLES.STORE_KEEPER, name: 'Ravi Store' });
  floor = await createTestUser({ role: ROLES.FLOOR_MANAGER });
  const buyerCo = await createTestBuyer();
  buyerUser = await createTestUser({ role: ROLES.BUYER, buyerId: buyerCo._id });
  order = await createTestOrder({ buyer: buyerCo, product: await createTestProduct(), createdBy: admin._id, status: 'PRODUCTION_COMPLETED' });
  machine = await Machine.create({ code: 'W-S1', name: 'Loom', type: 'WEAVING', ratedCmPerHour: 1500 });
  run = await ProductionRun.create({ runNumber: 'RUN-S-1', orderId: order._id, orderNumber: order.orderNumber, machineId: machine._id, machineCode: 'W-S1', targetCm: 500_000, producedCm: 500_000, rollCount: 2, status: 'COMPLETED', supervisorId: admin._id });
});

afterEach(async () => {
  await clearCatalog();
  await clearInventory();
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('RSA-PSS primitives', () => {
  const a = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const b = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const payload = canonicalJson({ record: { rollNumber: 'ROLL-1', result: 'PASS' }, nonce: 'n-1' });

  it('a valid signature verifies with the matching public key', () => {
    expect(verifyPayload(payload, signPayload(payload, a.privateKey), a.publicKey)).toBe(true);
  });
  it('a modified payload fails verification', () => {
    const sig = signPayload(payload, a.privateKey);
    expect(verifyPayload(payload.replace('PASS', 'REJECT'), sig, a.publicKey)).toBe(false);
  });
  it('the wrong public key fails verification', () => {
    expect(verifyPayload(payload, signPayload(payload, a.privateKey), b.publicKey)).toBe(false);
  });
  it('an invalid or missing signature fails (and never throws)', () => {
    expect(verifyPayload(payload, 'not-base64-signature', a.publicKey)).toBe(false);
    expect(verifyPayload(payload, '', a.publicKey)).toBe(false);
    expect(verifyPayload(payload, signPayload(payload, a.privateKey), 'not a key')).toBe(false);
  });
  it('PSS is randomised: two signatures of the same payload differ, both verify', () => {
    const s1 = signPayload(payload, a.privateKey);
    const s2 = signPayload(payload, a.privateKey);
    expect(s1).not.toBe(s2);
    expect(verifyPayload(payload, s1, a.publicKey) && verifyPayload(payload, s2, a.publicKey)).toBe(true);
  });
});

describe('signed QC approvals', () => {
  it('each decision (pass, rework, reject) is signed with the inspector\'s own key and verifies independently', async () => {
    const roll = await newRoll();
    const rework = await inspect(roll, { result: 'REWORK', defects: [{ type: 'STAINS', severity: 'MINOR' }], signature: { accepted: true } });
    expect(rework.status).toBe(201);
    expect(rework.body.data.signature).toMatchObject({ cryptographic: true, verified: true, hasHandwrittenAcknowledgment: false, statement: expect.stringContaining('needs rework') });
    await post(floor, `/api/rolls/${roll._id}/rework-done`, {});
    const pass = await inspect(roll, { result: 'PASS', signature: SIGNED });
    expect(pass.body.data.signature).toMatchObject({ hasHandwrittenAcknowledgment: true });

    // one signature per inspection, same personal key
    const sigs = await Signature.find({ entityType: 'QC_INSPECTION' }).lean();
    expect(sigs).toHaveLength(2);
    expect(new Set(sigs.map((s) => s.keyId)).size).toBe(1);
    expect(await SigningKey.countDocuments({ userId: qc._id, status: 'ACTIVE' })).toBe(1);

    const check = await verifyApi(store, pass.body.data.signature.id);
    expect(check.status).toBe(200);
    expect(check.body.data.verification).toMatchObject({ valid: true, kind: 'CRYPTOGRAPHIC', signature: { signerName: 'Meena QC', signerRole: 'QC_INSPECTOR', algorithm: 'RSA-PSS-SHA256' } });
    expect(check.body.data.verification.checks.every((c) => c.ok)).toBe(true);
    // metadata persisted and retrievable through the roll trace
    const trace = (await get(qc, `/api/rolls/${roll._id}`)).body.data;
    expect(trace.inspections.map((i) => i.signature?.cryptographic)).toEqual([true, true]);
  });

  it('a changed business record is detected: verification fails and the failure is audited', async () => {
    const roll = await newRoll();
    const res = await inspect(roll, { result: 'REJECT', defects: [{ type: 'HOLES', severity: 'CRITICAL' }], signature: SIGNED });
    // Tamper below the application (the model itself refuses updates).
    await QcInspection.collection.updateOne({ _id: QcInspection.castObject({ _id: res.body.data.inspection.id })._id }, { $set: { result: 'PASS' } });
    const check = (await verifyApi(admin, res.body.data.signature.id)).body.data.verification;
    expect(check.valid).toBe(false);
    expect(check.checks.find((c) => c.check === 'RECORD_UNCHANGED').ok).toBe(false);
    expect(check.checks.find((c) => c.check === 'RSA_SIGNATURE').ok).toBe(true); // the signature itself is intact
    expect(await AuditLog.countDocuments({ action: 'SIGNATURE_CHECK_FAILED' })).toBe(1);
  });

  it('a modified signed payload or a substituted signature is detected', async () => {
    const roll = await newRoll();
    const res = await inspect(roll, { result: 'PASS', signature: SIGNED });
    const id = res.body.data.signature.id;
    const stored = await Signature.findById(id).lean();
    await Signature.collection.updateOne({ _id: stored._id }, { $set: { payload: stored.payload.replace('"PASS"', '"REJECT"') } });
    let check = (await verifyApi(admin, id)).body.data.verification;
    expect(check.valid).toBe(false);
    expect(check.checks.filter((c) => !c.ok).map((c) => c.check)).toEqual(expect.arrayContaining(['PAYLOAD_HASH', 'RSA_SIGNATURE']));

    // substitute another person's valid signature: wrong key for this payload
    await Signature.collection.updateOne({ _id: stored._id }, { $set: { payload: stored.payload } });
    const other = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    await Signature.collection.updateOne({ _id: stored._id }, { $set: { signatureValue: signPayload(stored.payload, other.privateKey) } });
    check = (await verifyApi(admin, id)).body.data.verification;
    expect(check.checks.find((c) => c.check === 'RSA_SIGNATURE').ok).toBe(false);
  });

  it('without signed consent nothing is approved; unauthorized roles cannot sign', async () => {
    const roll = await newRoll();
    expect((await inspect(roll, { result: 'REJECT', defects: [{ type: 'HOLES', severity: 'CRITICAL' }] })).body.error.code).toBe('SIGNATURE_REQUIRED');
    for (const actor of [floor, store, buyerUser]) {
      expect((await inspect(roll, { result: 'PASS', signature: SIGNED }, actor)).status).toBe(403);
    }
    expect((await Roll.findById(roll._id).lean()).status).toBe('QC_PENDING');
    expect(await Signature.countDocuments({})).toBe(0);
    expect(await SigningKey.countDocuments({ userId: { $in: [floor._id, store._id, buyerUser._id] } })).toBe(0);
  });

  it('a signing key that cannot be opened stops the approval: nothing is committed', async () => {
    const roll = await newRoll();
    await inspect(await newRoll(), { result: 'PASS', signature: SIGNED }); // creates the key
    await SigningKey.collection.updateOne({ userId: qc._id }, { $set: { 'encryptedPrivateKey.kekId': 'another-kek' } });
    const res = await inspect(roll, { result: 'PASS', signature: SIGNED });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatchObject({ code: 'SIGNING_KEY_UNAVAILABLE', details: { failedStage: 'SIGNED' } });
    expect((await Roll.findById(roll._id).lean()).status).toBe('QC_PENDING');
    expect(await QcInspection.countDocuments({ rollId: roll._id })).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'QC_PASSED', entityId: roll._id })).toBe(0);
  });

  it('a replayed request returns the stored approval; a captured nonce cannot create a second signature', async () => {
    const roll = await newRoll();
    const key = newKey();
    const first = await inspect(roll, { result: 'PASS', signature: SIGNED }, qc, key);
    const again = await inspect(roll, { result: 'PASS', signature: SIGNED }, qc, key);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.data.signature.id).toBe(first.body.data.signature.id);
    expect(await Signature.countDocuments({})).toBe(1);
    const stored = await Signature.findById(first.body.data.signature.id).lean();
    const { _id, ...copy } = stored;
    await expect(Signature.collection.insertOne({ ...copy, entityId: roll._id })).rejects.toThrow(/duplicate key/);
  });

  it('private keys never leave the server; only public keys are shown', async () => {
    await inspect(await newRoll(), { result: 'PASS', signature: SIGNED });
    const mine = (await get(qc, '/api/signatures/keys/me')).body.data.key;
    expect(mine).toMatchObject({ algorithm: 'RSA-PSS-SHA256', modulusBits: 2048, status: 'ACTIVE', publicKeyPem: expect.stringContaining('BEGIN PUBLIC KEY') });
    expect(JSON.stringify(mine)).not.toMatch(/PRIVATE|encrypted|ciphertext/i);
    const raw = await SigningKey.findOne({ userId: qc._id }).lean();
    expect(raw.encryptedPrivateKey.ciphertext).not.toMatch(/PRIVATE KEY/);
    expect((await get(qc, `/api/signatures/keys/${store._id}`)).status).toBe(403);
    expect((await verifyApi(buyerUser, String(raw._id))).status).toBe(403);
  });

  it('rotation retires the key; old signatures still verify, new ones use the new key', async () => {
    const before = await inspect(await newRoll(), { result: 'PASS', signature: SIGNED });
    const rotated = await post(admin, `/api/signatures/keys/${qc._id}/rotate`, {});
    expect(rotated.status).toBe(201);
    expect(rotated.body.data.key.keyId).not.toBe(before.body.data.signature.keyId);
    const after = await inspect(await newRoll(), { result: 'PASS', signature: SIGNED });
    expect(after.body.data.signature.keyId).toBe(rotated.body.data.key.keyId);
    expect((await verifyApi(admin, before.body.data.signature.id)).body.data.verification.valid).toBe(true);
    expect(await AuditLog.countDocuments({ action: 'SIGNING_KEY_REVOKED' })).toBe(1);
    expect((await post(qc, `/api/signatures/keys/${qc._id}/rotate`, {})).status).toBe(403);
  });
});

describe('signed dispatch', () => {
  it('confirmation is signed by the store keeper and bound to the rolls, quantity and vehicle', async () => {
    const a = await newRoll();
    const b = await newRoll();
    await inspect(a, { result: 'PASS', signature: SIGNED });
    await inspect(b, { result: 'PASS', signature: SIGNED });
    const fgIds = (await FinishedGood.find({ orderId: order._id }).lean()).map((g) => String(g._id));
    const prepared = await post(store, '/api/dispatches', { orderId: String(order._id), finishedGoodIds: fgIds, vehicleNumber: 'TN 39 AB 1234' });
    const id = prepared.body.data.dispatch.id;

    expect((await post(qc, `/api/dispatches/${id}/confirm`, { signature: SIGNED })).status).toBe(403);
    const key = newKey();
    const confirmed = await post(store, `/api/dispatches/${id}/confirm`, { signature: { accepted: true } }, key);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.signature).toMatchObject({ cryptographic: true, verified: true, signerRole: 'STORE_KEEPER' });
    // a duplicate submission replays; the goods are dispatched once
    const again = await post(store, `/api/dispatches/${id}/confirm`, { signature: { accepted: true } }, key);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(await Signature.countDocuments({ entityType: 'DISPATCH' })).toBe(1);

    const sig = await Signature.findOne({ entityType: 'DISPATCH' }).lean();
    expect(JSON.parse(sig.payload).record).toMatchObject({ dispatchNumber: prepared.body.data.dispatch.dispatchNumber, totalLengthCm: 500_000, vehicleNumber: 'TN 39 AB 1234' });
    expect((await verifyApi(admin, String(sig._id))).body.data.verification.valid).toBe(true);

    // changing the dispatched quantity afterwards breaks verification
    await Dispatch.collection.updateOne({ _id: sig.entityId }, { $set: { totalLengthCm: 400_000 } });
    expect((await verifyApi(admin, String(sig._id))).body.data.verification.valid).toBe(false);
  });
});
