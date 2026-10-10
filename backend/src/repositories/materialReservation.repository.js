import { MaterialReservation, reservationStatus } from '../models/MaterialReservation.js';

export async function insertReservation(data, session) {
  const [reservation] = await MaterialReservation.create([data], { session });
  return reservation.toObject();
}

/** An order's reservations, oldest first (the order lots were allocated in). */
export function findReservationsForOrder(orderId, { session } = {}) {
  return MaterialReservation.find({ orderId }).sort({ createdAt: 1, _id: 1 }).session(session ?? null).lean();
}

/**
 * Adds to one counter only while `guard` (a $expr over the stored counters) still holds, then
 * stores the status that follows from the new counters. Returns the updated document or null.
 */
async function bumpGuarded(id, field, grams, guard, session) {
  const updated = await MaterialReservation.findOneAndUpdate(
    { _id: id, $expr: guard },
    { $inc: { [field]: grams } },
    { returnDocument: 'after', session, lean: true },
  );
  if (!updated) return null;
  const status = reservationStatus(updated);
  if (status === updated.status) return updated;
  return MaterialReservation.findOneAndUpdate({ _id: id }, { $set: { status } }, { returnDocument: 'after', session, lean: true });
}

const open = { $subtract: ['$reservedGrams', { $add: ['$issuedGrams', '$releasedGrams'] }] };
const onFloor = { $subtract: ['$issuedGrams', '$returnedGrams'] };

/** issued += grams, only while at least `grams` is still open. */
export const issueFromReservation = (id, grams, session) =>
  bumpGuarded(id, 'issuedGrams', grams, { $gte: [open, grams] }, session);

/** released += grams, only while at least `grams` is still open. */
export const releaseFromReservation = (id, grams, session) =>
  bumpGuarded(id, 'releasedGrams', grams, { $gte: [open, grams] }, session);

/** returned += grams, only while at least `grams` is still on the floor. */
export const returnToReservation = (id, grams, session) =>
  bumpGuarded(id, 'returnedGrams', grams, { $gte: [onFloor, grams] }, session);
