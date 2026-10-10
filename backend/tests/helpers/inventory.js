import { randomUUID } from 'node:crypto';
import { AuditLog } from '../../src/models/AuditLog.js';
import { IdempotencyRecord } from '../../src/models/IdempotencyRecord.js';
import { InventoryTransaction } from '../../src/models/InventoryTransaction.js';
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
  ]);
}

/** Append-only collections refuse deletes through their models, so tests clean up underneath. */
export async function clearInventory() {
  await Promise.all([
    YarnLot.deleteMany({}),
    IdempotencyRecord.deleteMany({}),
    InventoryTransaction.collection.deleteMany({}),
    AuditLog.collection.deleteMany({}),
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
