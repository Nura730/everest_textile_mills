import mongoose from 'mongoose';
import { gramsToKg } from '../utils/units.js';

const { Schema } = mongoose;

const integer = { validator: Number.isInteger, message: '{PATH} must be an integer' };

export const RESERVATION_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  PARTIALLY_ISSUED: 'PARTIALLY_ISSUED',
  FULLY_ISSUED: 'FULLY_ISSUED',
  RELEASED: 'RELEASED',
});

/**
 * Yarn from ONE lot set aside for ONE order (Phase 4). An order reserves its whole requirement,
 * possibly across several lots (one document per lot).
 *
 *   open    = reserved - issued - released   (still held in the lot's reservedGrams)
 *   onFloor = issued - returned               (handed to production, not yet back)
 *
 *   ACTIVE ──issue part──▶ PARTIALLY_ISSUED ──issue rest──▶ FULLY_ISSUED
 *     │                         │
 *     └──release (cancel)───────┴──▶ RELEASED   (the open grams return to available)
 *
 * Counters only ever grow, each change also appends a ledger row, and every update is guarded so
 * the invariants (0 <= open, returned <= issued) hold under concurrency.
 */
const materialReservationSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    yarnLotId: { type: Schema.Types.ObjectId, ref: 'YarnLot', required: true },
    // Snapshot for display: lot numbers never change.
    lotNumber: { type: String, required: true },
    reservedGrams: { type: Number, required: true, min: 1, validate: integer },
    issuedGrams: { type: Number, default: 0, min: 0, validate: integer },
    returnedGrams: { type: Number, default: 0, min: 0, validate: integer },
    releasedGrams: { type: Number, default: 0, min: 0, validate: integer },
    status: { type: String, required: true, enum: Object.values(RESERVATION_STATUS), default: RESERVATION_STATUS.ACTIVE },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

materialReservationSchema.index({ orderId: 1, createdAt: 1 });
materialReservationSchema.index({ yarnLotId: 1 });

export const openGrams = (r) => r.reservedGrams - r.issuedGrams - r.releasedGrams;
export const onFloorGrams = (r) => r.issuedGrams - r.returnedGrams;

/** The status that follows from the counters. */
export function reservationStatus(r) {
  if (openGrams(r) > 0) return r.issuedGrams > 0 ? RESERVATION_STATUS.PARTIALLY_ISSUED : RESERVATION_STATUS.ACTIVE;
  return r.releasedGrams > 0 ? RESERVATION_STATUS.RELEASED : RESERVATION_STATUS.FULLY_ISSUED;
}

export function toPublicReservation(r) {
  return {
    id: String(r._id),
    orderId: String(r.orderId),
    yarnLotId: String(r.yarnLotId),
    lotNumber: r.lotNumber,
    status: r.status,
    reservedKg: gramsToKg(r.reservedGrams),
    issuedKg: gramsToKg(r.issuedGrams),
    returnedKg: gramsToKg(r.returnedGrams),
    releasedKg: gramsToKg(r.releasedGrams),
    openKg: gramsToKg(openGrams(r)),
    onFloorKg: gramsToKg(onFloorGrams(r)),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export const MaterialReservation = mongoose.model('MaterialReservation', materialReservationSchema);
