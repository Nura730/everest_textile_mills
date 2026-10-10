import mongoose from 'mongoose';

/**
 * Snapshot isolation does not stop two transactions that write DIFFERENT documents from both
 * committing on stale reads (write skew). Writing one shared lock document turns that into a write
 * conflict: MongoDB aborts one transaction and withTransaction retries it with fresh reads.
 */
export async function claimLock(lockId, session) {
  await mongoose.connection.collection('locks').updateOne({ _id: lockId }, { $inc: { version: 1 } }, { upsert: true, session });
}

/**
 * One lock per material and colour, claimed by everything that changes who is promised which yarn:
 * order confirmation (feasibility) and reservation.
 */
export const claimYarnCommitmentLock = ({ material, colour }, session) => claimLock(`yarn-commitment:${material}:${colour}`, session);
