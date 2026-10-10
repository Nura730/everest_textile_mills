import mongoose from 'mongoose';
import { recordAudit } from '../../src/audit/recordAudit.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { AuditLog } from '../../src/models/AuditLog.js';

const actor = { id: '64b7f0c2a1b2c3d4e5f60718', role: 'STORE_KEEPER' };
const context = { actor, requestId: 'req-12345678', idempotencyKey: 'key-12345678' };
const entityId = new mongoose.Types.ObjectId();

async function inTransaction(work) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => work(session));
  } finally {
    await session.endSession();
  }
}

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await AuditLog.createCollection();
});

// Start every test from an empty trail: other suites' business actions also write audit entries.
beforeEach(async () => {
  await AuditLog.collection.deleteMany({});
});

afterEach(async () => {
  // Test cleanup goes around the model on purpose: the model itself refuses deletes.
  await AuditLog.collection.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('recordAudit', () => {
  it('writes an entry with actor, entity and request context', async () => {
    await inTransaction((session) =>
      recordAudit({ action: 'MATERIAL_RECEIVED', entityType: 'YarnLot', entityId, after: { totalGrams: 850000 } }, context, session),
    );

    const [entry] = await AuditLog.find().lean();
    expect(entry).toMatchObject({
      action: 'MATERIAL_RECEIVED',
      actorRole: 'STORE_KEEPER',
      entityType: 'YarnLot',
      source: 'ONLINE',
      requestId: 'req-12345678',
      idempotencyKey: 'key-12345678',
      after: { totalGrams: 850000 },
    });
    expect(String(entry.actorId)).toBe(actor.id);
    expect(entry.at).toBeInstanceOf(Date);
  });

  it('refuses to write outside a transaction', async () => {
    await expect(recordAudit({ action: 'X', entityType: 'Y', entityId }, context)).rejects.toThrow(/session/);
  });

  it('rolls back with the business transaction', async () => {
    await expect(
      inTransaction(async (session) => {
        await recordAudit({ action: 'MATERIAL_RECEIVED', entityType: 'YarnLot', entityId }, context, session);
        throw new Error('business step failed after the audit write');
      }),
    ).rejects.toThrow('business step failed');

    expect(await AuditLog.countDocuments()).toBe(0);
  });
});

describe('AuditLog is append-only', () => {
  let entry;

  beforeEach(async () => {
    entry = await inTransaction((session) =>
      recordAudit({ action: 'MATERIAL_RECEIVED', entityType: 'YarnLot', entityId }, context, session),
    );
  });

  it.each([
    ['updateOne', () => AuditLog.updateOne({}, { action: 'FORGED' })],
    ['updateMany', () => AuditLog.updateMany({}, { action: 'FORGED' })],
    ['findOneAndUpdate', () => AuditLog.findOneAndUpdate({}, { action: 'FORGED' })],
    ['replaceOne', () => AuditLog.replaceOne({}, { action: 'FORGED' })],
    ['deleteOne', () => AuditLog.deleteOne({})],
    ['deleteMany', () => AuditLog.deleteMany({})],
    ['findOneAndDelete', () => AuditLog.findOneAndDelete({})],
    ['bulkWrite', () => AuditLog.bulkWrite([{ deleteOne: { filter: {} } }])],
  ])('rejects %s', async (_name, mutate) => {
    await expect(mutate()).rejects.toThrow(/append-only/);
    expect(await AuditLog.countDocuments({ action: 'MATERIAL_RECEIVED' })).toBe(1);
  });

  it('rejects re-saving an existing entry', async () => {
    const doc = await AuditLog.findById(entry._id);
    doc.action = 'FORGED';
    await expect(doc.save()).rejects.toThrow(/append-only/);
  });

  it('rejects deleting a loaded entry', async () => {
    const doc = await AuditLog.findById(entry._id);
    await expect(doc.deleteOne()).rejects.toThrow(/append-only/);
  });

  it('records a correction as a new entry pointing at the original', async () => {
    await inTransaction((session) =>
      recordAudit(
        { action: 'STOCK_ADJUSTED', entityType: 'YarnLot', entityId, correctsAuditId: entry._id },
        context,
        session,
      ),
    );

    const entries = await AuditLog.find().sort({ at: 1 }).lean();
    expect(entries).toHaveLength(2);
    expect(entries[0].action).toBe('MATERIAL_RECEIVED');
    expect(String(entries[1].correctsAuditId)).toBe(String(entry._id));
  });
});
