import { recordAudit } from '../audit/recordAudit.js';
import { ROLES } from '../constants/roles.js';
import { toPublicTransaction } from '../models/InventoryTransaction.js';
import { toPublicLot } from '../models/YarnLot.js';
import {
  appendTransaction,
  findTransactionsPageForLot,
  sumDeltasByLot,
} from '../repositories/inventoryTransaction.repository.js';
import {
  findAllLotBalances,
  findLotById,
  findLotsPage,
  incrementTotalGuarded,
  insertLot,
  summarizeByMaterialAndColour,
} from '../repositories/yarnLot.repository.js';
import { AppError } from '../utils/AppError.js';
import { gramsToKg, kgToGrams } from '../utils/units.js';
import { executeIdempotent } from './idempotency.service.js';

/** Business rule: yarn cost is internal financial data, visible to the store and the owner only. */
export function canSeeCost(actor) {
  return actor.role === ROLES.STORE_KEEPER || actor.role === ROLES.ADMIN;
}

/**
 * Receive a yarn lot. One transaction creates the lot, its RECEIPT ledger row, the
 * MATERIAL_RECEIVED audit entry and the idempotency record: all of them or none of them.
 */
export function receiveLot(input, context) {
  return executeIdempotent({ context, operation: 'YARN_LOT_RECEIVE', request: input }, async (session) => {
    const totalGrams = kgToGrams(input.quantityKg);

    const lot = await insertLot(
      {
        lotNumber: input.lotNumber,
        material: input.material,
        colour: input.colour,
        yarnCount: input.yarnCount ?? null,
        supplierName: input.supplierName,
        costPerKgPaise: input.costPerKgPaise,
        receivedAt: input.receivedAt ?? new Date(),
        receivedBy: context.actor.id,
        totalGrams,
      },
      session,
    );

    await appendTransaction(
      {
        type: 'RECEIPT',
        yarnLotId: lot._id,
        deltaTotalGrams: totalGrams,
        deltaReservedGrams: 0,
        actorId: context.actor.id,
        idempotencyKey: context.idempotencyKey,
      },
      session,
    );

    await recordAudit(
      {
        action: 'MATERIAL_RECEIVED',
        entityType: 'YarnLot',
        entityId: lot._id,
        after: {
          lotNumber: lot.lotNumber,
          material: lot.material,
          colour: lot.colour,
          totalGrams,
          costPerKgPaise: lot.costPerKgPaise,
          supplierName: lot.supplierName,
        },
      },
      context,
      session,
    );

    return { statusCode: 201, body: { lot: toPublicLot(lot, { includeCost: canSeeCost(context.actor) }) } };
  });
}

async function requireLot(id) {
  const lot = await findLotById(id);
  if (!lot) throw new AppError('NOT_FOUND', 'Yarn lot not found');
  return lot;
}

export async function listLots({ material, colour, includeDepleted, page, limit }, actor) {
  const { lots, total } = await findLotsPage({ material, colour, includeDepleted }, { page, limit });
  const includeCost = canSeeCost(actor);
  return { lots: lots.map((lot) => toPublicLot(lot, { includeCost })), meta: { page, limit, total } };
}

export async function getLot(id, actor) {
  return toPublicLot(await requireLot(id), { includeCost: canSeeCost(actor) });
}

/** The ledger behind one lot, newest first: every receipt, adjustment, reservation and issue. */
export async function getLotTransactions(id, { type, from, to, page, limit }) {
  await requireLot(id);
  const { rows, total } = await findTransactionsPageForLot(id, { type, from, to }, { page, limit });
  return { transactions: rows.map(toPublicTransaction), meta: { page, limit, total } };
}

/** The store keeper's catalog: Cotton → Navy → total / reserved / available across all lots. */
export async function getYarnSummary({ material, includeDepleted }) {
  const groups = await summarizeByMaterialAndColour({ material, includeDepleted });
  return groups.map((group) => ({
    material: group._id.material,
    colour: group._id.colour,
    lots: group.lots,
    totalKg: gramsToKg(group.totalGrams),
    reservedKg: gramsToKg(group.reservedGrams),
    availableKg: gramsToKg(group.totalGrams - group.reservedGrams),
    oldestReceivedAt: group.oldestReceivedAt,
  }));
}

/**
 * Stock adjustment: a physical count differs from the system, or yarn was damaged.
 * Rules: ADMIN only (enforced on the route), a reason is mandatory, and a lot can never end up
 * holding less than is already reserved for orders (nor below zero). The guard is part of the
 * atomic update, so two concurrent write-offs cannot both slip through.
 */
export function adjustLot(lotId, { deltaKg, reason }, context) {
  return executeIdempotent(
    { context, operation: 'YARN_LOT_ADJUST', request: { lotId, deltaKg, reason } },
    async (session) => {
      const deltaGrams = kgToGrams(deltaKg);
      const before = await findLotById(lotId, { session });
      if (!before) throw new AppError('NOT_FOUND', 'Yarn lot not found');

      const after = await incrementTotalGuarded(lotId, deltaGrams, session);
      if (!after) {
        throw new AppError('INSUFFICIENT_STOCK', 'Adjustment would leave less stock than is reserved for orders', {
          details: {
            totalKg: gramsToKg(before.totalGrams),
            reservedKg: gramsToKg(before.reservedGrams),
            maxReductionKg: gramsToKg(before.totalGrams - before.reservedGrams),
            requestedDeltaKg: deltaKg,
          },
        });
      }

      const entry = await appendTransaction(
        {
          type: 'ADJUSTMENT',
          yarnLotId: after._id,
          deltaTotalGrams: deltaGrams,
          deltaReservedGrams: 0,
          reason,
          actorId: context.actor.id,
          idempotencyKey: context.idempotencyKey,
        },
        session,
      );

      await recordAudit(
        {
          action: 'STOCK_ADJUSTED',
          entityType: 'YarnLot',
          entityId: after._id,
          before: { totalGrams: before.totalGrams, reservedGrams: before.reservedGrams },
          after: { totalGrams: after.totalGrams, reservedGrams: after.reservedGrams, deltaGrams, reason },
        },
        context,
        session,
      );

      return {
        statusCode: 201,
        body: {
          lot: toPublicLot(after, { includeCost: canSeeCost(context.actor) }),
          transaction: toPublicTransaction(entry),
        },
      };
    },
  );
}

/**
 * Proves the stock numbers: for every lot, the balances stored on the lot must equal the sum of
 * its ledger rows, and 0 <= reserved <= total must hold. Anything else means a balance was
 * changed without a ledger entry (a bug, or someone editing the database directly).
 */
export async function reconcileInventory() {
  const [lots, sums] = await Promise.all([findAllLotBalances(), sumDeltasByLot()]);
  const ledgerByLot = new Map(sums.map((sum) => [String(sum._id), sum]));
  const mismatches = [];

  for (const lot of lots) {
    const id = String(lot._id);
    const ledger = ledgerByLot.get(id) ?? { totalGrams: 0, reservedGrams: 0, entries: 0 };
    ledgerByLot.delete(id);

    const issues = [];
    if (ledger.totalGrams !== lot.totalGrams) issues.push('TOTAL_MISMATCH');
    if (ledger.reservedGrams !== lot.reservedGrams) issues.push('RESERVED_MISMATCH');
    if (lot.reservedGrams < 0 || lot.reservedGrams > lot.totalGrams) issues.push('INVARIANT_VIOLATED');

    if (issues.length > 0) {
      mismatches.push({
        lotId: id,
        lotNumber: lot.lotNumber,
        issues,
        stored: { totalKg: gramsToKg(lot.totalGrams), reservedKg: gramsToKg(lot.reservedGrams) },
        ledger: { totalKg: gramsToKg(ledger.totalGrams), reservedKg: gramsToKg(ledger.reservedGrams), entries: ledger.entries },
      });
    }
  }

  // Whatever is left are ledger rows pointing at a lot that does not exist.
  for (const [id, ledger] of ledgerByLot) {
    mismatches.push({
      lotId: id,
      lotNumber: null,
      issues: ['LEDGER_WITHOUT_LOT'],
      stored: null,
      ledger: { totalKg: gramsToKg(ledger.totalGrams), reservedKg: gramsToKg(ledger.reservedGrams), entries: ledger.entries },
    });
  }

  return { checkedAt: new Date(), lotsChecked: lots.length, balanced: mismatches.length === 0, mismatches };
}
