import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase, getDbStatus } from '../../src/config/db.js';

describe('database connection', () => {
  afterAll(async () => {
    await disconnectDatabase();
  });

  it('fails fast when MongoDB is unreachable', async () => {
    const started = Date.now();

    await expect(
      connectDatabase('mongodb://127.0.0.1:1/unreachable', { serverSelectionTimeoutMS: 500 }),
    ).rejects.toThrow();

    expect(Date.now() - started).toBeLessThan(5000);
    expect(getDbStatus()).toBe('disconnected');
  });

  it('connects to the test replica set', async () => {
    await connectDatabase(process.env.MONGODB_URI);
    expect(getDbStatus()).toBe('connected');
  });

  it('supports multi-document transactions (required by Phase 3 inventory)', async () => {
    const Ledger = mongoose.model('TxnSmoke', new mongoose.Schema({ qty: Number }));
    await Ledger.createCollection();

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Ledger.create([{ qty: 850 }], { session });
        await Ledger.create([{ qty: -850 }], { session });
      });
    } finally {
      await session.endSession();
    }

    expect(await Ledger.countDocuments()).toBe(2);
    await Ledger.collection.drop();
  });

  it('reports disconnected after disconnecting', async () => {
    await disconnectDatabase();
    expect(getDbStatus()).toBe('disconnected');
  });
});
