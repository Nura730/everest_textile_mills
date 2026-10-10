import { createHash } from 'node:crypto';
import mongoose from 'mongoose';
import { IdempotencyRecord } from '../models/IdempotencyRecord.js';
import { AppError } from '../utils/AppError.js';

/** JSON with sorted object keys, so {a,b} and {b,a} hash the same. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hashRequest(operation, request) {
  return createHash('sha256').update(canonicalJson({ operation, request })).digest('hex');
}

function isIdempotencyKeyCollision(err) {
  return err?.code === 11000 && err.keyPattern?.actorId === 1 && err.keyPattern?.key === 1;
}

function replay(record, requestHash) {
  if (record.requestHash !== requestHash) {
    throw new AppError(
      'IDEMPOTENCY_KEY_REUSED',
      'This Idempotency-Key was already used for a different request. Generate a new key for a new action.',
    );
  }
  return { statusCode: record.statusCode, body: record.responseBody, replayed: true };
}

/**
 * Runs `work(session)` exactly once per (actor, Idempotency-Key).
 *
 * Inside ONE transaction: claim the key (placeholder record), do the business writes (which
 * include the ledger and audit entries), then store the response on the record. Either all of it
 * commits or none of it does, so a key is never "used up" by a failed attempt, and a successful
 * change can never exist without its record.
 *
 * Retrying with the same key and the same request replays the stored response; with a different
 * request it is 409 IDEMPOTENCY_KEY_REUSED. Failed attempts (4xx/5xx) are not stored, so a retry is
 * re-evaluated against current state (e.g. stock that has since arrived).
 *
 * work(session) must return { statusCode, body } and must use `session` for every write.
 */
export async function executeIdempotent({ context, operation, request }, work) {
  const actorId = context.actor.id;
  const key = context.idempotencyKey;
  if (!key) throw new Error('executeIdempotent requires context.idempotencyKey');
  const requestHash = hashRequest(operation, request);

  const session = await mongoose.startSession();
  try {
    let outcome;
    // withTransaction retries the whole callback on transient errors such as a write conflict
    // with a concurrent request using the same key; the retry then sees the committed record.
    await session.withTransaction(async () => {
      const existing = await IdempotencyRecord.findOne({ actorId, key }).session(session).lean();
      if (existing) {
        outcome = { existing };
        return;
      }

      await IdempotencyRecord.create([{ actorId, key, operation, requestHash }], { session });
      const result = await work(session);
      // Store exactly what the client will receive (ObjectIds and Dates become strings).
      const body = JSON.parse(JSON.stringify(result.body));
      await IdempotencyRecord.updateOne(
        { actorId, key },
        { $set: { statusCode: result.statusCode, responseBody: body } },
        { session },
      );
      outcome = { result: { statusCode: result.statusCode, body, replayed: false } };
    });

    return outcome.existing ? replay(outcome.existing, requestHash) : outcome.result;
  } catch (err) {
    // The other request committed between our read and our insert: replay its result.
    if (isIdempotencyKeyCollision(err)) {
      const record = await IdempotencyRecord.findOne({ actorId, key }).lean();
      return replay(record, requestHash);
    }
    throw err;
  } finally {
    await session.endSession();
  }
}
