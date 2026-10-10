import mongoose from 'mongoose';
import { gramsToKg } from '../utils/units.js';
import { appendOnly } from './plugins/appendOnly.js';

const { Schema } = mongoose;

/**
 * Ledger row types and how each moves a lot's balances:
 *   RECEIPT              total +q
 *   ADJUSTMENT           total ±q        (ADMIN, reason required)
 *   RESERVATION          reserved +q     (Phase 4)
 *   RESERVATION_RELEASE  reserved -q     (Phase 4)
 *   ISSUE                total -q, reserved -q   (reserved yarn handed to production, Phase 4)
 *   RETURN               total +q        (unused yarn back from the floor, Phase 4)
 */
export const INVENTORY_TRANSACTION_TYPES = Object.freeze([
  'RECEIPT',
  'ADJUSTMENT',
  'RESERVATION',
  'RESERVATION_RELEASE',
  'ISSUE',
  'RETURN',
]);

const integer = { validator: Number.isInteger, message: '{PATH} must be an integer' };

const inventoryTransactionSchema = new Schema(
  {
    type: { type: String, required: true, enum: INVENTORY_TRANSACTION_TYPES },
    yarnLotId: { type: Schema.Types.ObjectId, ref: 'YarnLot', required: true },
    deltaTotalGrams: { type: Number, required: true, validate: integer },
    deltaReservedGrams: { type: Number, required: true, validate: integer },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    reservationId: { type: Schema.Types.ObjectId, ref: 'MaterialReservation', default: null },
    runId: { type: Schema.Types.ObjectId, ref: 'ProductionRun', default: null },
    reason: { type: String, trim: true, maxlength: 500, default: null },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    idempotencyKey: { type: String, default: null },
    createdAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);

inventoryTransactionSchema.index({ yarnLotId: 1, createdAt: 1 });
inventoryTransactionSchema.index({ orderId: 1 }, { partialFilterExpression: { orderId: { $type: 'objectId' } } });
inventoryTransactionSchema.index({ runId: 1 }, { partialFilterExpression: { runId: { $type: 'objectId' } } });

// The ledger is the proof behind every balance: rows are never edited or removed.
inventoryTransactionSchema.plugin(appendOnly, { collectionLabel: 'inventoryTransactions' });

export function toPublicTransaction(entry) {
  return {
    id: String(entry._id),
    type: entry.type,
    yarnLotId: String(entry.yarnLotId),
    deltaTotalKg: gramsToKg(entry.deltaTotalGrams),
    deltaReservedKg: gramsToKg(entry.deltaReservedGrams),
    orderId: entry.orderId ? String(entry.orderId) : null,
    reservationId: entry.reservationId ? String(entry.reservationId) : null,
    runId: entry.runId ? String(entry.runId) : null,
    reason: entry.reason ?? null,
    actorId: String(entry.actorId),
    createdAt: entry.createdAt,
  };
}

export const InventoryTransaction = mongoose.model('InventoryTransaction', inventoryTransactionSchema);
