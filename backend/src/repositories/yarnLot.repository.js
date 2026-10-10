import { YarnLot } from '../models/YarnLot.js';

/*
 * Data access for yarn lots. Services decide WHAT should happen (business rules); this layer
 * knows HOW to do it safely in MongoDB. In particular every balance change is a single guarded
 * atomic update: the check and the write happen in one operation, so two concurrent requests can
 * never both pass a check that only one of them should pass.
 */

export async function insertLot(data, session) {
  const [lot] = await YarnLot.create([data], { session });
  return lot;
}

export function findLotById(id, { session } = {}) {
  return YarnLot.findById(id).session(session ?? null).lean();
}

export async function findLotsPage({ material, colour, includeDepleted }, { page, limit }) {
  const filter = {};
  if (material) filter.material = material;
  if (colour) filter.colour = colour;
  if (!includeDepleted) filter.totalGrams = { $gt: 0 };

  const [lots, total] = await Promise.all([
    YarnLot.find(filter)
      // Oldest first: the store should use (and reserve) older lots first (FIFO).
      .sort({ material: 1, colour: 1, receivedAt: 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    YarnLot.countDocuments(filter),
  ]);
  return { lots, total };
}

/**
 * total += deltaGrams, but only if the result stays >= reservedGrams (and therefore >= 0).
 * Returns the updated lot, or null when the guard failed (or the lot does not exist).
 */
export function incrementTotalGuarded(lotId, deltaGrams, session) {
  return YarnLot.findOneAndUpdate(
    { _id: lotId, $expr: { $gte: [{ $add: ['$totalGrams', deltaGrams] }, '$reservedGrams'] } },
    { $inc: { totalGrams: deltaGrams } },
    { returnDocument: 'after', session, lean: true },
  );
}

/** Stock by material and colour: the store keeper's catalog view (Cotton → Navy → 1,250 kg). */
export function summarizeByMaterialAndColour({ material, includeDepleted }) {
  const match = {};
  if (material) match.material = material;
  if (!includeDepleted) match.totalGrams = { $gt: 0 };

  return YarnLot.aggregate([
    { $match: match },
    {
      $group: {
        _id: { material: '$material', colour: '$colour' },
        lots: { $sum: 1 },
        totalGrams: { $sum: '$totalGrams' },
        reservedGrams: { $sum: '$reservedGrams' },
        oldestReceivedAt: { $min: '$receivedAt' },
      },
    },
    { $sort: { '_id.material': 1, '_id.colour': 1 } },
  ]);
}

/** Total and reserved grams across every lot of one material and colour (feasibility input). */
export async function sumStockForMaterialColour({ material, colour }, { session } = {}) {
  const [row] = await YarnLot.aggregate([
    { $match: { material, colour } },
    { $group: { _id: null, totalGrams: { $sum: '$totalGrams' }, reservedGrams: { $sum: '$reservedGrams' } } },
  ]).session(session ?? null);
  return { totalGrams: row?.totalGrams ?? 0, reservedGrams: row?.reservedGrams ?? 0 };
}

export function findAllLotBalances() {
  return YarnLot.find({}, { lotNumber: 1, totalGrams: 1, reservedGrams: 1 }).lean();
}

// ── Phase 4: reservation movements. Each is one guarded atomic update (check + write together). ──

/** Lots of one material and colour with yarn available, oldest first (FIFO). */
export function findAvailableLotsFifo({ material, colour }, { session } = {}) {
  return YarnLot.find({ material, colour, $expr: { $gt: ['$totalGrams', '$reservedGrams'] } })
    .sort({ receivedAt: 1, _id: 1 })
    .session(session ?? null)
    .lean();
}

export function findLotsByIds(ids, { session } = {}) {
  return YarnLot.find({ _id: { $in: ids } }).session(session ?? null).lean();
}

const updateLot = (filter, update, session) =>
  YarnLot.findOneAndUpdate(filter, update, { returnDocument: 'after', session, lean: true });

/** reserved += grams, only while at least `grams` is available (total - reserved). */
export const reserveInLotGuarded = (lotId, grams, session) =>
  updateLot({ _id: lotId, $expr: { $gte: [{ $subtract: ['$totalGrams', '$reservedGrams'] }, grams] } }, { $inc: { reservedGrams: grams } }, session);

/** reserved -= grams, only while at least `grams` is reserved. */
export const releaseReservedGuarded = (lotId, grams, session) =>
  updateLot({ _id: lotId, reservedGrams: { $gte: grams } }, { $inc: { reservedGrams: -grams } }, session);

/** Reserved yarn handed to production: total and reserved both drop, only while both cover it. */
export const issueFromLotGuarded = (lotId, grams, session) =>
  updateLot({ _id: lotId, reservedGrams: { $gte: grams }, totalGrams: { $gte: grams } }, { $inc: { totalGrams: -grams, reservedGrams: -grams } }, session);

/** Unused yarn back from the floor: total += grams. */
export const returnToLot = (lotId, grams, session) => updateLot({ _id: lotId }, { $inc: { totalGrams: grams } }, session);
