import { recordAudit } from '../audit/recordAudit.js';
import { ORDER_STATUS, allowedNextStatuses, canTransition } from '../constants/orderStatus.js';
import { ROLES } from '../constants/roles.js';
import { onFloorGrams, openGrams, toPublicReservation } from '../models/MaterialReservation.js';
import { toPublicOrder } from '../models/Order.js';
import { appendTransaction } from '../repositories/inventoryTransaction.repository.js';
import { claimYarnCommitmentLock } from '../repositories/locks.repository.js';
import {
  findReservationsForOrder,
  insertReservation,
  issueFromReservation,
  releaseFromReservation,
  returnToReservation,
} from '../repositories/materialReservation.repository.js';
import { findOrderById, transitionStatusGuarded } from '../repositories/order.repository.js';
import {
  findAvailableLotsFifo,
  findLotsByIds,
  issueFromLotGuarded,
  releaseReservedGuarded,
  reserveInLotGuarded,
  returnToLot,
} from '../repositories/yarnLot.repository.js';
import { AppError } from '../utils/AppError.js';
import { gramsToKg, kgToGrams } from '../utils/units.js';
import { executeIdempotent } from './idempotency.service.js';

/*
 * Phase 4: material reservation for confirmed orders.
 *
 *   reserve  CONFIRMED -> MATERIAL_RESERVED   lot.reserved += q          (RESERVATION rows)
 *   issue    while MATERIAL_RESERVED          lot.total -= q, reserved -= q  (ISSUE rows)
 *   return   any status, up to what is on the floor   lot.total += q     (RETURN rows)
 *   release  on cancelling a reserved order   lot.reserved -= open       (RESERVATION_RELEASE rows)
 *
 * Every movement: guarded atomic lot update + reservation counter update + ledger row + audit
 * entry, in one transaction (with an Idempotency-Key for the user actions). The ledger rows carry
 * orderId and reservationId, so each lot's history shows which order its yarn went to.
 */

/** Statuses in which reserved yarn can be handed to the floor (IN_PRODUCTION arrives with Phase 8). */
const ISSUABLE_STATUSES = Object.freeze([ORDER_STATUS.MATERIAL_RESERVED, ORDER_STATUS.IN_PRODUCTION]);

const notFound = () => new AppError('NOT_FOUND', 'Order not found');

const invalidTransition = (order, to) =>
  new AppError('INVALID_STATE_TRANSITION', `An order in status ${order.status} cannot become ${to}`, {
    details: { from: order.status, to, allowed: allowedNextStatuses(order.status) },
  });

/**
 * Oldest lots first (FIFO: use older yarn first) until `grams` is covered. Pure.
 * lots: [{ _id, lotNumber, totalGrams, reservedGrams }] already sorted oldest first.
 * Returns [{ lot, grams }] or null when the lots together hold less than `grams` available.
 */
export function planFifoAllocation(lots, grams) {
  const plan = [];
  let remaining = grams;
  for (const lot of lots) {
    if (remaining === 0) break;
    const available = lot.totalGrams - lot.reservedGrams;
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    plan.push({ lot, grams: take });
    remaining -= take;
  }
  return remaining === 0 ? plan : null;
}

function validationError(path, message) {
  return new AppError('VALIDATION_ERROR', 'Request validation failed', { details: [{ location: 'body', path, message }] });
}

/** The store keeper's own lot choice, checked against the order (material, colour, exact total). */
async function planManualAllocation(order, allocations, session) {
  const ids = allocations.map((a) => a.yarnLotId);
  if (new Set(ids).size !== ids.length) throw validationError('allocations', 'each lot may appear only once');
  const lots = await findLotsByIds(ids, { session });
  const byId = new Map(lots.map((lot) => [String(lot._id), lot]));
  const plan = allocations.map((allocation, index) => {
    const lot = byId.get(allocation.yarnLotId);
    if (!lot) throw validationError(`allocations.${index}.yarnLotId`, 'does not exist');
    if (lot.material !== order.product.material || lot.colour !== order.product.colour) {
      throw validationError(
        `allocations.${index}.yarnLotId`,
        `lot ${lot.lotNumber} is ${lot.material} ${lot.colour}; this order needs ${order.product.material} ${order.product.colour}`,
      );
    }
    return { lot, grams: kgToGrams(allocation.quantityKg) };
  });
  const total = plan.reduce((sum, item) => sum + item.grams, 0);
  if (total !== order.requiredYarnGrams) {
    throw validationError(
      'allocations',
      `must add up to exactly ${gramsToKg(order.requiredYarnGrams)} kg (the order's yarn requirement); got ${gramsToKg(total)} kg`,
    );
  }
  return plan;
}

function insufficientForOrder(order, availableGrams) {
  return new AppError(
    'INSUFFICIENT_STOCK',
    `Not enough ${order.product.material} ${order.product.colour} yarn available to reserve ${gramsToKg(order.requiredYarnGrams)} kg`,
    {
      details: {
        requiredKg: gramsToKg(order.requiredYarnGrams),
        availableKg: gramsToKg(availableGrams),
        shortfallKg: gramsToKg(Math.max(0, order.requiredYarnGrams - availableGrams)),
      },
    },
  );
}

async function appendLedgerRow(type, { lot, reservation, order, deltaTotal, deltaReserved, reason }, context, session) {
  await appendTransaction(
    {
      type,
      yarnLotId: lot._id,
      deltaTotalGrams: deltaTotal,
      deltaReservedGrams: deltaReserved,
      orderId: order._id,
      reservationId: reservation._id,
      reason: reason ?? null,
      actorId: context.actor.id,
      idempotencyKey: context.idempotencyKey ?? null,
    },
    session,
  );
}

const reservationSummary = (reservations) => reservations.map((r) => ({ lotNumber: r.lotNumber, grams: r.reservedGrams }));

/**
 * Reserve the order's whole yarn requirement (FLOOR_MANAGER or ADMIN). Without `allocations` the
 * oldest lots are used first; with them, the store keeper's choice is used as long as it matches
 * the order's material and colour and adds up exactly. All or nothing: a partial reservation is
 * never stored.
 */
export function reserveForOrder(orderId, { allocations }, context) {
  return executeIdempotent(
    { context, operation: 'ORDER_RESERVE', request: { orderId, allocations: allocations ?? null } },
    async (session) => {
      const order = await findOrderById(orderId, { session });
      if (!order) throw notFound();
      if (!canTransition(order.status, ORDER_STATUS.MATERIAL_RESERVED)) throw invalidTransition(order, ORDER_STATUS.MATERIAL_RESERVED);

      // Serialise with confirmations and other reservations of the same yarn.
      await claimYarnCommitmentLock(order.product, session);

      let plan;
      if (allocations) {
        plan = await planManualAllocation(order, allocations, session);
      } else {
        const lots = await findAvailableLotsFifo(order.product, { session });
        plan = planFifoAllocation(lots, order.requiredYarnGrams);
        if (!plan) throw insufficientForOrder(order, lots.reduce((sum, lot) => sum + lot.totalGrams - lot.reservedGrams, 0));
      }

      const reservations = [];
      for (const { lot, grams } of plan) {
        const updatedLot = await reserveInLotGuarded(lot._id, grams, session);
        if (!updatedLot) {
          throw new AppError('INSUFFICIENT_STOCK', `Lot ${lot.lotNumber} does not have ${gramsToKg(grams)} kg available`, {
            details: { lotNumber: lot.lotNumber, requestedKg: gramsToKg(grams), availableKg: gramsToKg(lot.totalGrams - lot.reservedGrams) },
          });
        }
        const reservation = await insertReservation(
          { orderId: order._id, yarnLotId: lot._id, lotNumber: lot.lotNumber, reservedGrams: grams, createdBy: context.actor.id },
          session,
        );
        await appendLedgerRow('RESERVATION', { lot, reservation, order, deltaTotal: 0, deltaReserved: grams }, context, session);
        reservations.push(reservation);
      }

      const updated = await transitionStatusGuarded(
        order._id,
        order.status,
        ORDER_STATUS.MATERIAL_RESERVED,
        { from: order.status, to: ORDER_STATUS.MATERIAL_RESERVED, at: new Date(), by: context.actor.id, byRole: context.actor.role },
        session,
      );
      if (!updated) throw invalidTransition(order, ORDER_STATUS.MATERIAL_RESERVED);

      await recordAudit(
        {
          action: 'MATERIAL_RESERVED',
          entityType: 'Order',
          entityId: order._id,
          orderId: order._id,
          before: { status: order.status },
          after: { status: ORDER_STATUS.MATERIAL_RESERVED, totalGrams: order.requiredYarnGrams, lots: reservationSummary(reservations), mode: allocations ? 'MANUAL' : 'FIFO' },
        },
        context,
        session,
      );

      return {
        statusCode: 200,
        body: { order: toPublicOrder(updated, context.actor), reservations: reservations.map(toPublicReservation) },
      };
    },
  );
}

/**
 * Reserve MORE yarn for an order already in production planning (FLOOR_MANAGER or ADMIN), e.g. for a
 * continuation run or to remake rejected rolls. Oldest lots first, all or nothing, from FREE stock only
 * (never from yarn reserved for other orders), with a reason; at most one more full requirement per
 * request so a typo cannot lock up the store. Insufficient stock is refused with the exact shortfall:
 * the store keeper resolves it by receiving yarn. Same ledger and audit as the first reservation.
 */
export function reserveAdditional(orderId, { quantityKg, reason }, context) {
  return executeIdempotent(
    { context, operation: 'ORDER_RESERVE_ADDITIONAL', request: { orderId, quantityKg, reason } },
    async (session) => {
      const order = await findOrderById(orderId, { session });
      if (!order) throw notFound();
      if (!ISSUABLE_STATUSES.includes(order.status)) {
        throw new AppError('INVALID_STATE_TRANSITION', `More yarn can be reserved only while an order is reserved or in production (this one is ${order.status})`, {
          details: { status: order.status, allowed: ISSUABLE_STATUSES },
        });
      }
      const grams = kgToGrams(quantityKg);
      if (grams > order.requiredYarnGrams) {
        throw new AppError('VALIDATION_ERROR', 'Request validation failed', {
          details: [{ location: 'body', path: 'quantityKg', message: `at most ${gramsToKg(order.requiredYarnGrams)} kg (one full requirement of the order) per request` }],
        });
      }
      await claimYarnCommitmentLock(order.product, session);
      const lots = await findAvailableLotsFifo(order.product, { session });
      const plan = planFifoAllocation(lots, grams);
      if (!plan) {
        const availableGrams = lots.reduce((sum, lot) => sum + lot.totalGrams - lot.reservedGrams, 0);
        throw new AppError('INSUFFICIENT_STOCK', `Only ${gramsToKg(availableGrams)} kg of free ${order.product.material.toLowerCase()} ${order.product.colour} yarn is in stock; ${gramsToKg(grams - availableGrams)} kg more is needed. The store keeper can receive it, then reserve again.`, {
          details: { requestedKg: quantityKg, availableKg: gramsToKg(availableGrams), shortfallKg: gramsToKg(grams - availableGrams) },
        });
      }
      const reservations = [];
      for (const { lot, grams: take } of plan) {
        const updatedLot = await reserveInLotGuarded(lot._id, take, session);
        if (!updatedLot) {
          throw new AppError('INSUFFICIENT_STOCK', `Lot ${lot.lotNumber} does not have ${gramsToKg(take)} kg available`, {
            details: { lotNumber: lot.lotNumber, requestedKg: gramsToKg(take), availableKg: gramsToKg(lot.totalGrams - lot.reservedGrams) },
          });
        }
        const reservation = await insertReservation(
          { orderId: order._id, yarnLotId: lot._id, lotNumber: lot.lotNumber, reservedGrams: take, createdBy: context.actor.id },
          session,
        );
        await appendLedgerRow('RESERVATION', { lot, reservation, order, deltaTotal: 0, deltaReserved: take, reason }, context, session);
        reservations.push(reservation);
      }
      await recordAudit(
        { action: 'MATERIAL_RESERVED_ADDITIONAL', entityType: 'Order', entityId: order._id, orderId: order._id, after: { grams, reason, lots: reservationSummary(reservations) } },
        context,
        session,
      );
      return { statusCode: 200, body: { reservations: reservations.map(toPublicReservation) } };
    },
  );
}

function totals(reservations) {
  const sum = (fn) => gramsToKg(reservations.reduce((acc, r) => acc + fn(r), 0));
  return {
    reservedKg: sum((r) => r.reservedGrams),
    issuedKg: sum((r) => r.issuedGrams),
    returnedKg: sum((r) => r.returnedGrams),
    releasedKg: sum((r) => r.releasedGrams),
    openKg: sum(openGrams),
    onFloorKg: sum(onFloorGrams),
  };
}

/** The lots holding an order's yarn and where that yarn is now (internal roles; route-enforced). */
export async function getOrderReservations(orderId) {
  const order = await findOrderById(orderId);
  if (!order) throw notFound();
  const reservations = await findReservationsForOrder(order._id);
  return { reservations: reservations.map(toPublicReservation), totals: totals(reservations) };
}

/**
 * Spread `grams` over the reservations (oldest first), taking from each what `capacity` allows and
 * applying `apply` to each slice. Returns the touched slices.
 */
async function spread(reservations, grams, capacity, apply) {
  const slices = [];
  let remaining = grams;
  for (const reservation of reservations) {
    if (remaining === 0) break;
    const take = Math.min(capacity(reservation), remaining);
    if (take <= 0) continue;
    await apply(reservation, take);
    slices.push({ lotNumber: reservation.lotNumber, grams: take });
    remaining -= take;
  }
  return slices;
}

/**
 * Hand reserved yarn to the production floor (STORE_KEEPER or ADMIN). Partial issues are allowed;
 * at most what is still reserved (open). The yarn leaves the lot: total and reserved both drop.
 */
export function issueForOrder(orderId, { quantityKg }, context) {
  return executeIdempotent(
    { context, operation: 'ORDER_ISSUE', request: { orderId, quantityKg } },
    async (session) => {
      const order = await findOrderById(orderId, { session });
      if (!order) throw notFound();
      if (!ISSUABLE_STATUSES.includes(order.status)) {
        throw new AppError('CONFLICT', `Yarn can be issued only for an order whose yarn is reserved (this one is ${order.status})`, {
          details: { status: order.status },
        });
      }
      const grams = kgToGrams(quantityKg);
      const reservations = await findReservationsForOrder(order._id, { session });
      const openTotal = reservations.reduce((sum, r) => sum + openGrams(r), 0);
      if (grams > openTotal) {
        throw new AppError('INSUFFICIENT_STOCK', `Only ${gramsToKg(openTotal)} kg of this order's reserved yarn is left to issue`, {
          details: { requestedKg: quantityKg, openKg: gramsToKg(openTotal) },
        });
      }

      const slices = await spread(reservations, grams, openGrams, async (reservation, take) => {
        const lot = await issueFromLotGuarded(reservation.yarnLotId, take, session);
        const updated = await issueFromReservation(reservation._id, take, session);
        if (!lot || !updated) throw new AppError('CONFLICT', 'The reservation changed meanwhile. Reload and try again.');
        await appendLedgerRow('ISSUE', { lot, reservation, order, deltaTotal: -take, deltaReserved: -take }, context, session);
      });

      await recordAudit(
        { action: 'MATERIAL_ISSUED', entityType: 'Order', entityId: order._id, orderId: order._id, after: { totalGrams: grams, lots: slices } },
        context,
        session,
      );
      const after = await findReservationsForOrder(order._id, { session });
      return { statusCode: 200, body: { reservations: after.map(toPublicReservation), totals: totals(after) } };
    },
  );
}

/**
 * Unused yarn back from the floor into the lot it came from (STORE_KEEPER or ADMIN). At most what
 * this order has on the floor (issued - returned); allowed in any status, because a cancelled
 * order's yarn may still need to come back. Reason required.
 */
export function returnForOrder(orderId, { quantityKg, reason }, context) {
  return executeIdempotent(
    { context, operation: 'ORDER_RETURN', request: { orderId, quantityKg, reason } },
    async (session) => {
      const order = await findOrderById(orderId, { session });
      if (!order) throw notFound();
      const grams = kgToGrams(quantityKg);
      const reservations = await findReservationsForOrder(order._id, { session });
      const floorTotal = reservations.reduce((sum, r) => sum + onFloorGrams(r), 0);
      if (grams > floorTotal) {
        throw new AppError('QUANTITY_EXCEEDS_ISSUED', `Only ${gramsToKg(floorTotal)} kg of this order's yarn is on the floor`, {
          details: { requestedKg: quantityKg, onFloorKg: gramsToKg(floorTotal) },
        });
      }

      const slices = await spread(reservations, grams, onFloorGrams, async (reservation, take) => {
        const updated = await returnToReservation(reservation._id, take, session);
        if (!updated) throw new AppError('CONFLICT', 'The reservation changed meanwhile. Reload and try again.');
        const lot = await returnToLot(reservation.yarnLotId, take, session);
        await appendLedgerRow('RETURN', { lot, reservation, order, deltaTotal: take, deltaReserved: 0, reason }, context, session);
      });

      await recordAudit(
        { action: 'MATERIAL_RETURNED', entityType: 'Order', entityId: order._id, orderId: order._id, after: { totalGrams: grams, lots: slices, reason } },
        context,
        session,
      );
      const after = await findReservationsForOrder(order._id, { session });
      return { statusCode: 200, body: { reservations: after.map(toPublicReservation), totals: totals(after) } };
    },
  );
}

/**
 * Release everything still reserved for an order (called inside the cancellation transaction).
 * Issued yarn is not touched: it is on the floor and comes back through returnForOrder.
 * Returns the released slices (empty when nothing was reserved).
 */
export async function releaseOrderReservations(order, { reason }, context, session) {
  const reservations = await findReservationsForOrder(order._id, { session });
  const slices = await spread(reservations, Number.MAX_SAFE_INTEGER, openGrams, async (reservation, take) => {
    const lot = await releaseReservedGuarded(reservation.yarnLotId, take, session);
    const updated = await releaseFromReservation(reservation._id, take, session);
    if (!lot || !updated) throw new AppError('CONFLICT', 'The reservation changed meanwhile. Reload and try again.');
    await appendLedgerRow('RESERVATION_RELEASE', { lot, reservation, order, deltaTotal: 0, deltaReserved: -take, reason }, context, session);
  });
  if (slices.length > 0) {
    await recordAudit(
      { action: 'MATERIAL_RELEASED', entityType: 'Order', entityId: order._id, orderId: order._id, after: { lots: slices, reason } },
      context,
      session,
    );
  }
  return slices;
}

/** Who may see an order's reservations: the planning roles (route-enforced; kept here for reuse). */
export const RESERVATION_VIEWERS = Object.freeze([ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.ADMIN]);
