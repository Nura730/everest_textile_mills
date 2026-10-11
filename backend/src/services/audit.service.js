import { recordAudit } from '../audit/recordAudit.js';
import { ROLES } from '../constants/roles.js';
import { AuditLog } from '../models/AuditLog.js';
import { Order } from '../models/Order.js';
import { User } from '../models/User.js';
import { AppError } from '../utils/AppError.js';
import { endOfIndiaDayExclusive, startOfIndiaDay } from '../utils/dates.js';
import { runInTransaction } from '../utils/transaction.js';

/*
 * Phase 13: the audit center. Every role reads the trail, but sees only what instruction.md §13 lets it:
 *   ADMIN         everything, with before/after and every filter;
 *   STORE_KEEPER  inventory, material movement, finished goods and dispatch;
 *   FLOOR_MANAGER machines, production, material issue/return, machine problems, attendance and workers;
 *   QC_INSPECTOR  QC, rolls, production and machine history around rolls, order lifecycle, attendance;
 *   BUYER         milestones of their own company's orders only, without internal details.
 * Money and cost fields are removed from before/after for everyone but the ADMIN.
 */

const ROLE_ACTIONS = {
  [ROLES.STORE_KEEPER]: [/^MATERIAL_/, /^STOCK_ADJUSTED$/, /^FINISHED_GOOD_/, /^DISPATCH_/, /^DELIVERY_/, /^ORDER_READY_FOR_DISPATCH$/, /^ORDER_DISPATCHED$/],
  [ROLES.FLOOR_MANAGER]: [/^MACHINE_/, /^RUN_/, /^ROLL_/, /^MATERIAL_ISSUED$/, /^MATERIAL_RETURNED$/, /^MATERIAL_RESERVED$/, /^MATERIAL_RESERVED_ADDITIONAL$/, /^QC_REWORK$/, /^ATTENDANCE_/, /^WORKER_/],
  [ROLES.QC_INSPECTOR]: [/^QC_/, /^ROLL_/, /^RUN_/, /^MACHINE_PROBLEM_/, /^FINISHED_GOOD_CREATED$/, /^ORDER_/, /^ATTENDANCE_/, /^WORKER_/],
};

/** Milestones a buyer may see on their own orders (no internal operations, no figures). */
export const BUYER_ACTIONS = new Set([
  'ORDER_CREATED',
  'ORDER_UPDATED',
  'ORDER_CONFIRMED',
  'ORDER_CANCELLED',
  'ORDER_REJECTED',
  'MATERIAL_RESERVED',
  'RUN_STARTED',
  'RUN_COMPLETED',
  'QC_PASSED',
  'ORDER_READY_FOR_DISPATCH',
  'DISPATCH_CONFIRMED',
  'ORDER_DISPATCHED',
  'DELIVERY_CONFIRMED',
  'DELIVERY_DISCREPANCY_REPORTED',
  'DELIVERY_VERIFIED',
  'INVOICE_ISSUED',
  'ORDER_INVOICED',
]);

/** Plain-language milestone names for the buyer's history. */
const BUYER_LABELS = {
  ORDER_CREATED: 'Order placed',
  ORDER_UPDATED: 'Order details changed',
  ORDER_CONFIRMED: 'Order confirmed',
  ORDER_CANCELLED: 'Order cancelled',
  ORDER_REJECTED: 'Order rejected',
  MATERIAL_RESERVED: 'Material reserved',
  RUN_STARTED: 'Production started',
  RUN_COMPLETED: 'Production run finished',
  QC_PASSED: 'Roll passed quality inspection',
  ORDER_READY_FOR_DISPATCH: 'Ready for dispatch',
  DISPATCH_CONFIRMED: 'Dispatched',
  ORDER_DISPATCHED: 'Order fully dispatched',
  DELIVERY_CONFIRMED: 'Delivery confirmed',
  DELIVERY_DISCREPANCY_REPORTED: 'Problem with a delivery reported',
  DELIVERY_VERIFIED: 'Delivery verified',
  INVOICE_ISSUED: 'Invoice issued',
  ORDER_INVOICED: 'Order invoiced',
};

// Money fields only (every amount is stored in paise; cost and price fields name money too).
// Quantities such as totalGrams stay visible.
const MONEY_KEY = /paise|cost|price|amount/i;

function stripMoney(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stripMoney);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !MONEY_KEY.test(key)).map(([key, v]) => [key, stripMoney(v)]));
}

export function allowedFor(role, action) {
  if (role === ROLES.ADMIN) return true;
  if (role === ROLES.BUYER) return BUYER_ACTIONS.has(action);
  return (ROLE_ACTIONS[role] ?? []).some((pattern) => pattern.test(action));
}

export function toPublicEntry(entry, actor, names) {
  if (actor.role === ROLES.BUYER) {
    return { id: String(entry._id), action: entry.action, label: BUYER_LABELS[entry.action] ?? entry.action, orderId: entry.orderId ? String(entry.orderId) : null, at: entry.at };
  }
  const admin = actor.role === ROLES.ADMIN;
  return {
    id: String(entry._id),
    action: entry.action,
    actorId: admin ? String(entry.actorId) : null,
    actorName: names.get(String(entry.actorId)) ?? null,
    actorRole: entry.actorRole,
    entityType: entry.entityType,
    entityId: String(entry.entityId),
    orderId: entry.orderId ? String(entry.orderId) : null,
    machineId: entry.machineId ? String(entry.machineId) : null,
    before: admin ? entry.before : stripMoney(entry.before),
    after: admin ? entry.after : stripMoney(entry.after),
    source: entry.source,
    correctsAuditId: entry.correctsAuditId ? String(entry.correctsAuditId) : null,
    at: entry.at,
  };
}

/** Filters the trail for the caller: their role's actions, plus (for a buyer) their own orders only. */
export async function listAudit({ actorId, actorRole, orderId, machineId, action, entityType, from, to, page, limit }, actor) {
  const filter = {};
  const admin = actor.role === ROLES.ADMIN;
  if (admin) {
    if (actorId) filter.actorId = actorId;
    if (actorRole) filter.actorRole = actorRole;
    if (entityType) filter.entityType = entityType;
  }
  if (orderId) filter.orderId = orderId;
  if (machineId && actor.role !== ROLES.BUYER) filter.machineId = machineId;
  if (from || to) {
    filter.at = {};
    if (from) filter.at.$gte = startOfIndiaDay(from);
    if (to) filter.at.$lt = endOfIndiaDayExclusive(to);
  }

  if (actor.role === ROLES.BUYER) {
    const own = actor.buyerId ? await Order.find({ buyerId: actor.buyerId }, { _id: 1 }).lean() : [];
    const ids = own.map((o) => o._id);
    filter.orderId = orderId ? (ids.some((id) => String(id) === orderId) ? orderId : { $in: [] }) : { $in: ids };
    filter.action = action ? (BUYER_ACTIONS.has(action) ? action : { $in: [] }) : { $in: [...BUYER_ACTIONS] };
  } else if (!admin) {
    const allowed = (ROLE_ACTIONS[actor.role] ?? []).map((pattern) => ({ action: pattern }));
    if (action) filter.action = allowedFor(actor.role, action) ? action : { $in: [] };
    else filter.$or = allowed;
  } else if (action) {
    filter.action = action;
  }

  const [entries, total] = await Promise.all([
    AuditLog.find(filter).sort({ at: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditLog.countDocuments(filter),
  ]);
  const names = new Map();
  if (actor.role !== ROLES.BUYER) {
    const users = await User.find({ _id: { $in: [...new Set(entries.map((e) => String(e.actorId)))] } }, { name: 1 }).lean();
    users.forEach((u) => names.set(String(u._id), u.name));
  }
  return { entries: entries.map((e) => toPublicEntry(e, actor, names)), meta: { page, limit, total } };
}

/** The distinct actions recorded so far (ADMIN filter options). */
export async function listAuditActions() {
  return (await AuditLog.distinct('action')).sort();
}

/**
 * A correction (ADMIN): a NEW entry that references the one it corrects and explains why. The original
 * is never changed (instruction.md §12: "Original event → correction event").
 */
export function correctAudit(id, { note }, context) {
  return runInTransaction(async (session) => {
    const original = await AuditLog.findById(id).session(session).lean();
    if (!original) throw new AppError('NOT_FOUND', 'Audit entry not found');
    const entry = await recordAudit(
      {
        action: 'AUDIT_CORRECTION',
        entityType: original.entityType,
        entityId: original.entityId,
        orderId: original.orderId,
        machineId: original.machineId,
        before: { action: original.action, at: original.at },
        after: { note },
        correctsAuditId: original._id,
      },
      context,
      session,
    );
    return toPublicEntry(entry.toObject(), context.actor, new Map([[String(context.actor.id), context.actor.name]]));
  });
}
