import mongoose from 'mongoose';

/**
 * Runs work(session) in one MongoDB transaction and returns its result. Used for changes that
 * must commit together with their audit entry but do not need an Idempotency-Key (for those,
 * use executeIdempotent, which opens its own transaction).
 */
export async function runInTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
