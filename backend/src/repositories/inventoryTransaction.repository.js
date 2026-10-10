import { InventoryTransaction } from '../models/InventoryTransaction.js';
import { endOfIndiaDayExclusive, startOfIndiaDay } from '../utils/dates.js';

export async function appendTransaction(entry, session) {
  const [row] = await InventoryTransaction.create([entry], { session });
  return row;
}

export async function findTransactionsPageForLot(yarnLotId, { type, from, to }, { page, limit }) {
  const filter = { yarnLotId };
  if (type) filter.type = type;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = startOfIndiaDay(from);
    if (to) filter.createdAt.$lt = endOfIndiaDayExclusive(to);
  }
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
