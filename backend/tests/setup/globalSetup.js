import { randomBytes } from 'node:crypto';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

// A single-node REPLICA SET, not a standalone server: Phase 3 inventory uses
// multi-document transactions, which a standalone mongod rejects.
export default async function globalSetup() {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  globalThis.__MONGO_REPLSET__ = replSet;
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = replSet.getUri('everest_test');
  // Fresh random secret per run: no test can depend on a hard-coded value.
  process.env.JWT_SECRET = randomBytes(48).toString('base64url');
  // A throwaway key-encryption key for the per-user signing keys; 2048-bit keys keep tests fast.
  process.env.SIGNING_KEY_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.SIGNING_RSA_BITS = '2048';
  // Minimum cost keeps hashing fast in tests; production enforces >= 10.
  process.env.BCRYPT_ROUNDS = '4';
}
