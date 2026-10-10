import { recordAudit } from '../audit/recordAudit.js';
import { ROLES } from '../constants/roles.js';
import { toPublicLot } from '../models/YarnLot.js';
import { appendTransaction } from '../repositories/inventoryTransaction.repository.js';
import { insertLot } from '../repositories/yarnLot.repository.js';
import { kgToGrams } from '../utils/units.js';
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
