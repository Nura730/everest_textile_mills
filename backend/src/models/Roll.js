import mongoose from 'mongoose';
import { ROLL_STATUS } from '../constants/production.js';
import { cmToMetres, gramsToKg } from '../utils/units.js';

const { Schema } = mongoose;

const integer = { validator: Number.isInteger, message: '{PATH} must be an integer' };

/**
 * A fabric roll produced by a run (recorded in Phase 8; QC moves it on in Phase 10).
 * Traceability is stored on the roll itself: the order, run, machine and the yarn lots issued to the
 * order when it was made, so "which machine and which yarn made this roll?" is one read.
 */
const rollSchema = new Schema(
  {
    rollNumber: { type: String, required: true, unique: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    orderNumber: { type: String, required: true },
    runId: { type: Schema.Types.ObjectId, ref: 'ProductionRun', required: true },
    runNumber: { type: String, required: true },
    machineId: { type: Schema.Types.ObjectId, ref: 'Machine', required: true },
    machineCode: { type: String, required: true },
    yarnLots: {
      type: [{ yarnLotId: { type: Schema.Types.ObjectId, ref: 'YarnLot', required: true }, lotNumber: { type: String, required: true }, _id: false }],
      default: [],
    },
    lengthCm: { type: Number, required: true, min: 1, validate: integer },
    // Optional: a roll may be recorded before it is weighed.
    weightGrams: { type: Number, min: 1, validate: { validator: (v) => v === null || Number.isInteger(v), message: '{PATH} must be an integer' }, default: null },
    status: { type: String, required: true, enum: Object.values(ROLL_STATUS), default: ROLL_STATUS.QC_PENDING },
    producedAt: { type: Date, default: () => new Date() },
    producedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reworkCount: { type: Number, default: 0, min: 0, validate: integer },
  },
  { timestamps: true },
);

rollSchema.index({ runId: 1, producedAt: 1 });
rollSchema.index({ orderId: 1, status: 1 });
rollSchema.index({ status: 1, producedAt: 1 });

export function toPublicRoll(roll) {
  return {
    id: String(roll._id),
    rollNumber: roll.rollNumber,
    orderId: String(roll.orderId),
    orderNumber: roll.orderNumber,
    runId: String(roll.runId),
    runNumber: roll.runNumber,
    machineId: String(roll.machineId),
    machineCode: roll.machineCode,
    yarnLots: roll.yarnLots.map((lot) => ({ yarnLotId: String(lot.yarnLotId), lotNumber: lot.lotNumber })),
    lengthMetres: cmToMetres(roll.lengthCm),
    weightKg: roll.weightGrams === null || roll.weightGrams === undefined ? null : gramsToKg(roll.weightGrams),
    status: roll.status,
    producedAt: roll.producedAt,
    producedBy: String(roll.producedBy),
    reworkCount: roll.reworkCount,
  };
}

export const Roll = mongoose.model('Roll', rollSchema);
