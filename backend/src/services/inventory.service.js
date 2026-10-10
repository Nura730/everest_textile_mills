import { recordAudit } from '../audit/recordAudit.js';
import { ROLES } from '../constants/roles.js';
import { toPublicTransaction } from '../models/InventoryTransaction.js';
import { toPublicLot } from '../models/YarnLot.js';
import { appendTransaction, findTransactionsPageForLot } from '../repositories/inventoryTransaction.repository.js';
import {
  findLotById,
  findLotsPage,
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
export async function getLotTransactions(id, { page, limit }) {
  await requireLot(id);
  const { rows, total } = await findTransactionsPageForLot(id, { page, limit });
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
