import mongoose from 'mongoose';
import { appendOnly } from './plugins/appendOnly.js';

const { Schema } = mongoose;

const integer = { validator: Number.isInteger, message: '{PATH} must be an integer' };
const money = { type: Number, required: true, min: 0, validate: integer };

/**
 * The cost assumptions (Phase 14, decision D6: labour = hourly rate × production-run hours; no
 * attendance/wage module). Versioned and append-only: a change is a new version effective from its
 * creation, and every cost figure names the version it used. Also holds the factory's working hours
 * per day, which the risk engine (Phase 17) uses to turn machine speed into days.
 */
const rateCardSchema = new Schema(
  {
    version: { type: Number, required: true, unique: true, min: 1 },
    labourPaisePerHour: money,
    machinePaisePerHour: {
      SPINNING: money,
      WEAVING: money,
      DYEING: money,
      FINISHING: money,
    },
    reworkPaisePerRoll: money,
    overheadBasisPoints: { type: Number, required: true, min: 0, max: 10_000, validate: integer },
    workingHoursPerDay: { type: Number, required: true, min: 1, max: 24, validate: integer },
    note: { type: String, trim: true, maxlength: 500, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    effectiveFrom: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
rateCardSchema.plugin(appendOnly, { collectionLabel: 'rateCards' });

/** Defaults used until the owner saves their own rates. Stated as assumptions wherever shown. */
export const DEFAULT_RATES = Object.freeze({
  version: 0,
  labourPaisePerHour: 12_000, // ₹120/h, roughly a ₹900 shift wage over 8 hours
  machinePaisePerHour: Object.freeze({ SPINNING: 8_000, WEAVING: 6_000, DYEING: 15_000, FINISHING: 7_000 }),
  reworkPaisePerRoll: 25_000, // ₹250 handling and re-processing per reworked roll
  overheadBasisPoints: 800, // 8% of direct cost
  workingHoursPerDay: 16, // two 8-hour shifts
  note: 'Default assumptions (not yet set by the owner)',
  effectiveFrom: null,
});

export function toPublicRateCard(card) {
  return {
    version: card.version,
    labourPaisePerHour: card.labourPaisePerHour,
    machinePaisePerHour: { ...card.machinePaisePerHour },
    reworkPaisePerRoll: card.reworkPaisePerRoll,
    overheadBasisPoints: card.overheadBasisPoints,
    workingHoursPerDay: card.workingHoursPerDay,
    note: card.note ?? null,
    effectiveFrom: card.effectiveFrom ?? null,
    isDefault: card.version === 0,
  };
}

export const RateCard = mongoose.model('RateCard', rateCardSchema);

/** The rate card in force at a moment (latest version effective by then), or the defaults. */
export async function rateCardAt(at = new Date()) {
  const card = await RateCard.findOne({ effectiveFrom: { $lte: at } }).sort({ version: -1 }).lean();
  return card ?? DEFAULT_RATES;
}
