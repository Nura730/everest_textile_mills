import { randomUUID } from 'node:crypto';
import { AuditLog } from '../../src/models/AuditLog.js';
import { IdempotencyRecord } from '../../src/models/IdempotencyRecord.js';
import { InventoryTransaction } from '../../src/models/InventoryTransaction.js';
import { Dispatch, FinishedGood, Invoice } from '../../src/models/Fulfilment.js';
import { Machine } from '../../src/models/Machine.js';
import { MachineEvent } from '../../src/models/MachineEvent.js';
import { MaterialReservation } from '../../src/models/MaterialReservation.js';
import { ProductionRun } from '../../src/models/ProductionRun.js';
import { QcInspection } from '../../src/models/QcInspection.js';
import { Roll } from '../../src/models/Roll.js';
import { Signature } from '../../src/models/Signature.js';
import { YarnLot } from '../../src/models/YarnLot.js';

export const newKey = () => randomUUID();

let lotSeq = 0;
export function receiptBody(overrides = {}) {
  lotSeq += 1;
  return {
    lotNumber: `GRN-2026-${String(lotSeq).padStart(4, '0')}`,
    material: 'COTTON',
    colour: 'Navy',
    supplierName: 'Sri Lakshmi Spinners',
    quantityKg: 1250,
    costPerKgPaise: 32000,
    ...overrides,
  };
}

export async function ensureInventoryCollections() {
  await Promise.all([
    YarnLot.init(),
    IdempotencyRecord.init(),
    InventoryTransaction.createCollection(),
    AuditLog.createCollection(),
    MaterialReservation.createCollection(),
    Machine.init(),
    MachineEvent.init(),
    ProductionRun.init(),
    Roll.init(),
    QcInspection.init(),
    Signature.init(),
    FinishedGood.init(),
    Dispatch.init(),
    Invoice.init(),
  ]);
}

/** Append-only collections refuse deletes through their models, so tests clean up underneath. */
export async function clearInventory() {
  await Promise.all([
    YarnLot.deleteMany({}),
    IdempotencyRecord.deleteMany({}),
    InventoryTransaction.collection.deleteMany({}),
    AuditLog.collection.deleteMany({}),
    MaterialReservation.deleteMany({}),
    // Production data (seed:dev also creates machines), so no suite leaks it into the next.
    Machine.deleteMany({}),
    MachineEvent.collection.deleteMany({}),
    ProductionRun.deleteMany({}),
    Roll.deleteMany({}),
    QcInspection.collection.deleteMany({}),
    Signature.collection.deleteMany({}),
    FinishedGood.deleteMany({}),
    Dispatch.deleteMany({}),
    Invoice.deleteMany({}),
  ]);
}

export async function counts() {
  const [lots, ledger, audits, keys] = await Promise.all([
    YarnLot.countDocuments(),
    InventoryTransaction.countDocuments(),
    AuditLog.countDocuments(),
    IdempotencyRecord.countDocuments(),
  ]);
  return { lots, ledger, audits, keys };
}
