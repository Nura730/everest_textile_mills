import { MongoMemoryReplSet } from 'mongodb-memory-server';

// A single-node REPLICA SET, not a standalone server: Phase 3 inventory uses
// multi-document transactions, which a standalone mongod rejects.
export default async function globalSetup() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  globalThis.__MONGO_REPLSET__ = replSet;
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = replSet.getUri('everest_test');
}
