import mongoose from 'mongoose';
import { gramsToKg } from '../utils/units.js';

const { Schema } = mongoose;

export const YARN_MATERIALS = Object.freeze([
  'COTTON',
  'POLYESTER',
  'VISCOSE',
  'NYLON',
  'WOOL',
  'SILK',
  'LINEN',
  'BLEND',
]);

const integer = { validator: Number.isInteger, message: '{PATH} must be an integer' };

/**
 * One received batch of yarn. Holds running balances; every change to them also appends an
 * InventoryTransaction (the ledger), in the same MongoDB transaction.
 * Invariant: 0 <= reservedGrams <= totalGrams. Available is computed, never stored.
 * Balances are only ever changed through yarnLot.repository's guarded atomic updates.
 */
const yarnLotSchema = new Schema(
  {
    lotNumber: { type: String, required: true, trim: true, uppercase: true, unique: true, maxlength: 40 },
    material: { type: String, required: true, enum: YARN_MATERIALS },
    colour: { type: String, required: true, trim: true, maxlength: 50 },
    yarnCount: { type: String, trim: true, maxlength: 20, default: null },
    supplierName: { type: String, required: true, trim: true, maxlength: 120 },
    costPerKgPaise: { type: Number, required: true, min: 0, validate: integer },
    receivedAt: { type: Date, required: true },
    receivedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    totalGrams: { type: Number, required: true, min: 0, validate: integer },
    reservedGrams: { type: Number, default: 0, min: 0, validate: integer },
  },
  { timestamps: true },
);

// Catalog browsing (Cotton → Navy) and FIFO selection of the oldest lot.
yarnLotSchema.index({ material: 1, colour: 1, receivedAt: 1 });

/**
 * The only lot shape the API returns. Cost is internal financial data: included only when the
 * caller's role may see it (STORE_KEEPER, ADMIN), never for the floor.
 */
export function toPublicLot(lot, { includeCost }) {
  const publicLot = {
    id: String(lot._id),
    lotNumber: lot.lotNumber,
    material: lot.material,
    colour: lot.colour,
    yarnCount: lot.yarnCount ?? null,
    supplierName: lot.supplierName,
    totalKg: gramsToKg(lot.totalGrams),
    reservedKg: gramsToKg(lot.reservedGrams),
    availableKg: gramsToKg(lot.totalGrams - lot.reservedGrams),
    receivedAt: lot.receivedAt,
    receivedBy: String(lot.receivedBy),
    createdAt: lot.createdAt,
  };
  if (includeCost) publicLot.costPerKgPaise = lot.costPerKgPaise;
  return publicLot;
}

export const YarnLot = mongoose.model('YarnLot', yarnLotSchema);
