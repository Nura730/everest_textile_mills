import { jest } from '@jest/globals';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { IdempotencyRecord } from '../../src/models/IdempotencyRecord.js';
import { canonicalJson, executeIdempotent, hashRequest } from '../../src/services/idempotency.service.js';
import { AppError } from '../../src/utils/AppError.js';

// A throwaway collection standing in for "the business change".
const Probe = mongoose.model('IdempotencyProbe', new mongoose.Schema({ label: String }));

const alice = { id: '64b7f0c2a1b2c3d4e5f60718', role: 'STORE_KEEPER' };
const bob = { id: '64b7f0c2a1b2c3d4e5f60719', role: 'STORE_KEEPER' };
const ctx = (actor, key) => ({ actor, idempotencyKey: key, requestId: 'req-1' });

function createProbe(label) {
  return async (session) => {
    const [doc] = await Probe.create([{ label }], { session });
    return { statusCode: 201, body: { probe: { id: doc._id, label, at: new Date('2026-10-10T00:00:00Z') } } };
  };
}

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await Promise.all([IdempotencyRecord.init(), Probe.createCollection()]);
});

afterEach(async () => {
  await Promise.all([IdempotencyRecord.deleteMany({}), Probe.deleteMany({})]);
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('request hashing', () => {
  it('is independent of key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    expect(hashRequest('OP', { a: 1, b: 2 })).toBe(hashRequest('OP', { b: 2, a: 1 }));
  });

  it('differs for different operations or payloads', () => {
    expect(hashRequest('OP', { a: 1 })).not.toBe(hashRequest('OP', { a: 2 }));
    expect(hashRequest('OP1', { a: 1 })).not.toBe(hashRequest('OP2', { a: 1 }));
  });
});

describe('executeIdempotent', () => {
  const request = { label: 'receipt' };

  it('runs the work once and stores the response', async () => {
    const result = await executeIdempotent({ context: ctx(alice, 'key-00000001'), operation: 'TEST', request }, createProbe('a'));

    expect(result).toMatchObject({ statusCode: 201, replayed: false });
    expect(result.body.probe.at).toBe('2026-10-10T00:00:00.000Z'); // serialised like the HTTP response
    const record = await IdempotencyRecord.findOne().lean();
    expect(record).toMatchObject({ key: 'key-00000001', operation: 'TEST', statusCode: 201 });
    expect(record.responseBody).toEqual(result.body);
  });

  it('replays the stored response for the same key and request without running the work again', async () => {
    const first = await executeIdempotent({ context: ctx(alice, 'key-00000002'), operation: 'TEST', request }, createProbe('a'));
    const work = jest.fn(createProbe('a'));
    const second = await executeIdempotent({ context: ctx(alice, 'key-00000002'), operation: 'TEST', request }, work);

    expect(work).not.toHaveBeenCalled();
    expect(second).toEqual({ ...first, replayed: true });
    expect(await Probe.countDocuments()).toBe(1);
  });

  it('rejects the same key with a different request (409 IDEMPOTENCY_KEY_REUSED)', async () => {
    await executeIdempotent({ context: ctx(alice, 'key-00000003'), operation: 'TEST', request }, createProbe('a'));

    await expect(
      executeIdempotent({ context: ctx(alice, 'key-00000003'), operation: 'TEST', request: { label: 'other' } }, createProbe('b')),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', status: 409 });
    expect(await Probe.countDocuments()).toBe(1);
  });

  it('scopes keys per actor: the same key from another user is a separate request', async () => {
    await executeIdempotent({ context: ctx(alice, 'key-00000004'), operation: 'TEST', request }, createProbe('alice'));
    const bobs = await executeIdempotent({ context: ctx(bob, 'key-00000004'), operation: 'TEST', request }, createProbe('bob'));

    expect(bobs.replayed).toBe(false);
    expect(bobs.body.probe.label).toBe('bob');
    expect(await Probe.countDocuments()).toBe(2);
  });

  it('persists nothing when the work fails, and does not consume the key', async () => {
    const failing = async (session) => {
      await Probe.create([{ label: 'half-done' }], { session });
      throw new AppError('CONFLICT', 'business rule failed midway');
    };

    await expect(
      executeIdempotent({ context: ctx(alice, 'key-00000005'), operation: 'TEST', request }, failing),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await Probe.countDocuments()).toBe(0);
    expect(await IdempotencyRecord.countDocuments()).toBe(0);

    const retry = await executeIdempotent({ context: ctx(alice, 'key-00000005'), operation: 'TEST', request }, createProbe('a'));
    expect(retry.replayed).toBe(false);
    expect(await Probe.countDocuments()).toBe(1);
  });

  it('applies the change exactly once when the same request arrives concurrently', async () => {
    const calls = Array.from({ length: 5 }, () =>
      executeIdempotent({ context: ctx(alice, 'key-00000006'), operation: 'TEST', request }, createProbe('a')),
    );
    const results = await Promise.all(calls);

    expect(await Probe.countDocuments()).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    for (const result of results) expect(result.body).toEqual(results[0].body);
  });

  it('requires a key', async () => {
    await expect(
      executeIdempotent({ context: ctx(alice, null), operation: 'TEST', request }, createProbe('a')),
    ).rejects.toThrow(/idempotencyKey/);
  });
});
