import { CHECK_RESULT, FEASIBILITY_CHECK, FEASIBILITY_STATUS } from '../constants/feasibility.js';
import { ORDER_STATUS } from '../constants/orderStatus.js';
import { sumOrderYarnGrams } from '../repositories/order.repository.js';
import { sumStockForMaterialColour } from '../repositories/yarnLot.repository.js';
import { dateStringToDate, dateToDateString, todayInIndia } from '../utils/dates.js';
import { gramsToKg } from '../utils/units.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const kg = (grams) => `${gramsToKg(grams).toLocaleString('en-IN', { maximumFractionDigits: 3 })} kg`;

/** Whole calendar days from `from` to `to` (both "YYYY-MM-DD"); negative when `to` is earlier. */
export function daysBetween(from, to) {
  return Math.round((dateStringToDate(to) - dateStringToDate(from)) / MS_PER_DAY);
}

/**
 * The feasibility verdict, from plain numbers (pure: no database, no clock).
 *
 * Material: yarn of the order's material and colour that is still FREE must cover the requirement.
 *   free = (total − reserved across lots) − yarn already promised to other CONFIRMED orders.
 *   Confirmed orders do not hold reservations until Phase 4 reserves them, so without the second
 *   term two orders could both be confirmed against the same kilograms.
 * Deadline: the required-by date must still be in the future (India calendar).
 * Machine capacity: not part of confirmation (NOT_ASSESSED); it never fails an order. Delivery risk
 * against machine capacity is assessed separately by the intelligence service (Insights).
 *
 * All quantities are integer grams.
 */
export function evaluateFeasibility({
  requiredYarnGrams,
  material,
  colour,
  stock: { totalGrams, reservedGrams },
  committedGrams,
  requiredBy,
  today,
  now = new Date(),
}) {
  const availableGrams = totalGrams - reservedGrams;
  const freeGrams = Math.max(0, availableGrams - committedGrams);
  const shortfallGrams = Math.max(0, requiredYarnGrams - freeGrams);
  const daysToDeadline = daysBetween(today, requiredBy);

  const yarn = `${material} ${colour} yarn`;
  const freeExplained = `${kg(availableGrams)} available in stock − ${kg(committedGrams)} promised to other confirmed orders`;
  const materialCheck =
    shortfallGrams === 0
      ? {
          code: FEASIBILITY_CHECK.MATERIAL,
          result: CHECK_RESULT.PASS,
          message: `Needs ${kg(requiredYarnGrams)} of ${yarn}; ${kg(freeGrams)} is free (${freeExplained}).`,
        }
      : {
          code: FEASIBILITY_CHECK.MATERIAL,
          result: CHECK_RESULT.FAIL,
          message: `Short by ${kg(shortfallGrams)}: needs ${kg(requiredYarnGrams)} of ${yarn} but only ${kg(freeGrams)} is free (${freeExplained}).`,
        };

  let deadlineCheck;
  if (daysToDeadline > 0) {
    deadlineCheck = {
      code: FEASIBILITY_CHECK.DEADLINE,
      result: CHECK_RESULT.PASS,
      message: `${daysToDeadline} day${daysToDeadline === 1 ? '' : 's'} left until the required-by date (${requiredBy}).`,
    };
  } else {
    deadlineCheck = {
      code: FEASIBILITY_CHECK.DEADLINE,
      result: CHECK_RESULT.FAIL,
      message:
        daysToDeadline === 0
          ? `The required-by date (${requiredBy}) is today: there is no time left to produce.`
          : `The required-by date (${requiredBy}) has passed.`,
    };
  }

  const capacityCheck = {
    code: FEASIBILITY_CHECK.MACHINE_CAPACITY,
    result: CHECK_RESULT.NOT_ASSESSED,
    message: 'Machine capacity is not part of this check; the delivery outlook against machine capacity is on the Insights page.',
  };

  const checks = [materialCheck, deadlineCheck, capacityCheck];
  return {
    status: checks.some((check) => check.result === CHECK_RESULT.FAIL)
      ? FEASIBILITY_STATUS.NOT_FEASIBLE
      : FEASIBILITY_STATUS.FEASIBLE,
    checks,
    inputs: {
      requiredYarnGrams,
      stockTotalGrams: totalGrams,
      stockReservedGrams: reservedGrams,
      committedGrams,
      freeGrams,
      shortfallGrams,
      requiredBy,
      assessedOn: today,
      daysToDeadline,
    },
    computedAt: now,
  };
}

/** Gathers the current numbers for one order and evaluates them. Pass the transaction's session. */
export async function assessOrderFeasibility(order, { session } = {}) {
  const { material, colour } = order.product;
  // Sequential on purpose: operations sharing a transaction's session must not run concurrently.
  const stock = await sumStockForMaterialColour({ material, colour }, { session });
  const committedGrams = await sumOrderYarnGrams(
    { material, colour, status: ORDER_STATUS.CONFIRMED, excludeOrderId: order._id },
    { session },
  );
  return evaluateFeasibility({
    requiredYarnGrams: order.requiredYarnGrams,
    material,
    colour,
    stock,
    committedGrams,
    requiredBy: dateToDateString(order.requiredBy),
    today: todayInIndia(),
  });
}
