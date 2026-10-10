import { InventoryTransaction } from '../models/InventoryTransaction.js';

export async function appendTransaction(entry, session) {
  const [row] = await InventoryTransaction.create([entry], { session });
  return row;
}

export async function findTransactionsPageForLot(yarnLotId, { page, limit }) {
  const filter = { yarnLotId };
  const [rows, total] = await Promise.all([
    InventoryTransaction.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    InventoryTransaction.countDocuments(filter),
  ]);
  return { rows, total };
}

/** Σ deltas per lot: what the ledger says each lot's balances must be. */
export function sumDeltasByLot() {
  return InventoryTransaction.aggregate([
    {
      $group: {
        _id: '$yarnLotId',
        totalGrams: { $sum: '$deltaTotalGrams' },
        reservedGrams: { $sum: '$deltaReservedGrams' },
        entries: { $sum: 1 },
      },
    },
  ]);
}
