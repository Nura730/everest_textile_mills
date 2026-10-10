import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { InventoryTransaction, toPublicTransaction } from '../../src/models/InventoryTransaction.js';
import { YarnLot, toPublicLot } from '../../src/models/YarnLot.js';
import { appendTransaction, sumDeltasByLot } from '../../src/repositories/inventoryTransaction.repository.js';
import {
  findLotsPage,
  incrementTotalGuarded,
  insertLot,
  summarizeByMaterialAndColour,
} from '../../src/repositories/yarnLot.repository.js';

const actorId = new mongoose.Types.ObjectId();

function lotData(overrides = {}) {
  return {
    lotNumber: `LOT-${new mongoose.Types.ObjectId().toString().slice(-6)}`,
    material: 'COTTON',
    colour: 'Navy',
    supplierName: 'Sri Lakshmi Spinners',
    costPerKgPaise: 32000,
    receivedAt: new Date('2026-10-01T09:00:00Z'),
    receivedBy: actorId,
    totalGrams: 1_250_000,
    ...overrides,
  };
}

async function inTransaction(work) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(() => work(session));
  } finally {
    await session.endSession();
  }
}

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await Promise.all([YarnLot.init(), InventoryTransaction.createCollection()]);
});

afterEach(async () => {
  await YarnLot.deleteMany({});
  await InventoryTransaction.collection.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('YarnLot model', () => {
  it('uppercases the lot number and rejects duplicates', async () => {
    const lot = await inTransaction((s) => insertLot(lotData({ lotNumber: 'grn-104' }), s));
    expect(lot.lotNumber).toBe('GRN-104');

    await expect(inTransaction((s) => insertLot(lotData({ lotNumber: 'GRN-104' }), s))).rejects.toMatchObject({ code: 11000 });
  });

  it.each([
    ['a fractional gram', { totalGrams: 10.5 }],
    ['negative stock', { totalGrams: -1 }],
    ['fractional paise', { costPerKgPaise: 1.5 }],
    ['an unknown material', { material: 'JUTE' }],
  ])('rejects %s', async (_label, overrides) => {
    await expect(inTransaction((s) => insertLot(lotData(overrides), s))).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('computes available in the public shape and hides cost unless allowed', async () => {
    const lot = await inTransaction((s) => insertLot(lotData({ reservedGrams: 850_000 }), s));

    expect(toPublicLot(lot, { includeCost: false })).toMatchObject({ totalKg: 1250, reservedKg: 850, availableKg: 400 });
    expect(toPublicLot(lot, { includeCost: false })).not.toHaveProperty('costPerKgPaise');
    expect(toPublicLot(lot, { includeCost: true }).costPerKgPaise).toBe(32000);
  });
});

describe('incrementTotalGuarded', () => {
  it('applies a delta that keeps total >= reserved', async () => {
    const lot = await inTransaction((s) => insertLot(lotData({ reservedGrams: 850_000 }), s));
    const updated = await inTransaction((s) => incrementTotalGuarded(lot._id, -400_000, s));

    expect(updated.totalGrams).toBe(850_000);
  });

  it('refuses a delta that would drop total below reserved', async () => {
    const lot = await inTransaction((s) => insertLot(lotData({ reservedGrams: 850_000 }), s));
    const updated = await inTransaction((s) => incrementTotalGuarded(lot._id, -400_001, s));

    expect(updated).toBeNull();
    expect((await YarnLot.findById(lot._id).lean()).totalGrams).toBe(1_250_000);
  });

  it('lets only one of two concurrent decrements win when both cannot fit', async () => {
    const lot = await inTransaction((s) => insertLot(lotData({ totalGrams: 100_000 }), s));
    const results = await Promise.allSettled([
      inTransaction((s) => incrementTotalGuarded(lot._id, -60_000, s)),
      inTransaction((s) => incrementTotalGuarded(lot._id, -60_000, s)),
    ]);

    const applied = results.filter((r) => r.status === 'fulfilled' && r.value !== null);
    expect(applied).toHaveLength(1);
    expect((await YarnLot.findById(lot._id).lean()).totalGrams).toBe(40_000);
  });
});

describe('queries', () => {
  it('pages lots oldest first and hides depleted lots by default', async () => {
    await inTransaction(async (s) => {
      await insertLot(lotData({ lotNumber: 'NEW', receivedAt: new Date('2026-10-05') }), s);
      await insertLot(lotData({ lotNumber: 'OLD', receivedAt: new Date('2026-09-01') }), s);
      await insertLot(lotData({ lotNumber: 'EMPTY', totalGrams: 0 }), s);
    });

    const visible = await findLotsPage({}, { page: 1, limit: 10 });
    const all = await findLotsPage({ includeDepleted: true }, { page: 1, limit: 10 });

    expect(visible.lots.map((lot) => lot.lotNumber)).toEqual(['OLD', 'NEW']);
    expect(all.total).toBe(3);
  });

  it('summarises by material and colour', async () => {
    await inTransaction(async (s) => {
      await insertLot(lotData({ totalGrams: 1_000_000, reservedGrams: 300_000 }), s);
      await insertLot(lotData({ totalGrams: 250_000 }), s);
      await insertLot(lotData({ colour: 'Red', totalGrams: 50_000 }), s);
    });

    const summary = await summarizeByMaterialAndColour({});
    expect(summary).toEqual([
      expect.objectContaining({ _id: { material: 'COTTON', colour: 'Navy' }, lots: 2, totalGrams: 1_250_000, reservedGrams: 300_000 }),
      expect.objectContaining({ _id: { material: 'COTTON', colour: 'Red' }, lots: 1, totalGrams: 50_000, reservedGrams: 0 }),
    ]);
  });
});

describe('InventoryTransaction ledger', () => {
  it('appends rows and sums them per lot', async () => {
    const lotId = new mongoose.Types.ObjectId();
    await inTransaction(async (s) => {
      await appendTransaction({ type: 'RECEIPT', yarnLotId: lotId, deltaTotalGrams: 1_000_000, deltaReservedGrams: 0, actorId }, s);
      await appendTransaction({ type: 'ADJUSTMENT', yarnLotId: lotId, deltaTotalGrams: -2_500, deltaReservedGrams: 0, reason: 'count', actorId }, s);
    });

    const [sums] = await sumDeltasByLot();
    expect(sums).toMatchObject({ totalGrams: 997_500, reservedGrams: 0, entries: 2 });
  });

  it('is append-only', async () => {
    const lotId = new mongoose.Types.ObjectId();
    await inTransaction((s) =>
      appendTransaction({ type: 'RECEIPT', yarnLotId: lotId, deltaTotalGrams: 1000, deltaReservedGrams: 0, actorId }, s),
    );

    await expect(InventoryTransaction.updateOne({}, { deltaTotalGrams: 999_999 })).rejects.toThrow(/append-only/);
    await expect(InventoryTransaction.deleteMany({})).rejects.toThrow(/append-only/);
  });

  it('exposes kg in its public shape', async () => {
    const lotId = new mongoose.Types.ObjectId();
    const row = await inTransaction((s) =>
      appendTransaction({ type: 'RECEIPT', yarnLotId: lotId, deltaTotalGrams: 850_000, deltaReservedGrams: 0, actorId }, s),
    );
    expect(toPublicTransaction(row)).toMatchObject({ type: 'RECEIPT', deltaTotalKg: 850, deltaReservedKg: 0, orderId: null });
  });
});
