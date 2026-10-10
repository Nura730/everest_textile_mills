import { z } from 'zod';
import { ROLES } from '../constants/roles.js';
import { SYNC_OUTCOME, SyncEvent } from '../models/SyncEvent.js';
import { reportProblemBodySchema } from '../validators/machine.validators.js';
import { receiveLotBodySchema } from '../validators/inventory.validators.js';
import { adminCreateOrderBodySchema, buyerCreateOrderBodySchema, updateOrderBodySchema } from '../validators/order.validators.js';
import { completeRunBodySchema, reasonBodySchema, recordRollBodySchema } from '../validators/production.validators.js';
import { inspectRollBodySchema, reworkDoneBodySchema } from '../validators/quality.validators.js';
import { objectIdSchema } from '../validators/common.validators.js';
import * as inventory from './inventory.service.js';
import * as machines from './machine.service.js';
import * as orders from './order.service.js';
import * as production from './production.service.js';
import * as quality from './quality.service.js';

/*
 * Phase 15: replay of actions captured offline (instruction.md §14). The device queues events with a
 * UUID eventId and sends them on reconnect. Each event goes through the SAME service as the online
 * action, with source OFFLINE and the eventId as the idempotency key, so it is applied at most once
 * and passes every business rule (stock, state transitions, locks) against the CURRENT state.
 *
 * Outcomes: APPLIED; DUPLICATE (eventId seen before: its stored outcome is returned); CONFLICT (the
 * factory moved on: e.g. the run was already paused, so a 409 business rule refused it); REJECTED
 * (bad data, wrong role, unknown record). A transient server failure is reported as RETRY and not
 * stored, so the device keeps the event and sends it again later.
 *
 * Offline actions (instruction.md Phase 13, plus the safe ordering and receiving steps): production
 * pause/resume/complete, recording a roll, reporting a machine problem, QC inspection (signature captured
 * on the device), finishing rework, placing or editing an order, recording a yarn receipt. Everything that
 * needs live state or cannot be undone (confirming orders, reserving/issuing yarn, dispatch, invoices,
 * user and master data) stays online-only.
 */

const FLOOR = [ROLES.FLOOR_MANAGER, ROLES.ADMIN];
const QC = [ROLES.QC_INSPECTOR, ROLES.ADMIN];
const ORDERING = [ROLES.BUYER, ROLES.ADMIN];
const STORE = [ROLES.STORE_KEEPER, ROLES.ADMIN];
const empty = z.strictObject({});

/**
 * One offline action. `idKey` names the record the action targets (taken out of the payload); the rest
 * of the payload is the request body and is validated with the SAME schema as the online route, so the
 * rules and the idempotency hash are identical: a queued copy of an online attempt whose response was
 * lost replays the stored result instead of applying twice.
 */
const handler = (roles, idKey, bodySchema, apply) => ({ roles, idKey, bodySchema, apply });

/** type → handler. The online route each mirrors is noted. */
export const SYNC_HANDLERS = Object.freeze({
  // POST /production-runs/:id/{pause,resume,complete,rolls}
  RUN_PAUSE: handler(FLOOR, 'runId', reasonBodySchema, (id, body, ctx) => production.pauseRun(id, body, ctx)),
  RUN_RESUME: handler(FLOOR, 'runId', empty, (id, body, ctx) => production.resumeRun(id, ctx)),
  RUN_COMPLETE: handler(FLOOR, 'runId', completeRunBodySchema, (id, body, ctx) => production.completeRun(id, body, ctx)),
  ROLL_RECORD: handler(FLOOR, 'runId', recordRollBodySchema, (id, body, ctx) => production.recordRoll(id, body, ctx)),
  // POST /machines/:id/problems
  MACHINE_PROBLEM_REPORT: handler(FLOOR, 'machineId', reportProblemBodySchema, (id, body, ctx) => machines.reportProblem(id, body, ctx)),
  // POST /rolls/:id/inspections, /rolls/:id/rework-done
  QC_INSPECT: handler(QC, 'rollId', inspectRollBodySchema, (id, body, ctx) => quality.inspectRoll(id, body, ctx)),
  REWORK_DONE: handler(FLOOR, 'rollId', reworkDoneBodySchema, (id, body, ctx) => quality.completeRework(id, body, ctx)),
  // POST /orders (a request only: nothing is confirmed until the admin confirms it online)
  ORDER_CREATE: handler(ORDERING, null, (actor) => (actor.role === ROLES.ADMIN ? adminCreateOrderBodySchema : buyerCreateOrderBodySchema), (id, body, ctx) => orders.createOrder(body, ctx)),
  // PATCH /orders/:id (expectedUpdatedAt makes a stale offline edit a CONFLICT, never an overwrite)
  ORDER_UPDATE: handler(ORDERING, 'orderId', updateOrderBodySchema, (id, body, ctx) => orders.updateOrder(id, body, ctx)),
  // POST /yarn-lots (records goods that physically arrived; only adds stock)
  MATERIAL_RECEIVE: handler(STORE, null, receiveLotBodySchema, (id, body, ctx) => inventory.receiveLot(body, ctx)),
});

/** Splits and validates a payload: { success, id, body } or { success: false, issues }. */
export function parsePayload(type, payload, actor) {
  const h = SYNC_HANDLERS[type];
  const { [h.idKey ?? '']: rawId, ...rest } = payload ?? {};
  const issues = [];
  let id = null;
  if (h.idKey) {
    const idResult = objectIdSchema.safeParse(rawId);
    if (idResult.success) id = idResult.data;
    else issues.push({ path: h.idKey, message: 'must be a valid id' });
  }
  const schema = typeof h.bodySchema === 'function' ? h.bodySchema(actor) : h.bodySchema;
  const bodyResult = schema.safeParse(h.idKey ? rest : payload ?? {});
  if (!bodyResult.success) issues.push(...bodyResult.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return issues.length ? { success: false, issues } : { success: true, id, body: bodyResult.data };
}
export const SYNC_EVENT_TYPES = Object.keys(SYNC_HANDLERS);

const failure = (code, message, details) => ({ code, message, ...(details ? { details } : {}) });

/** A refused business rule (409) means state changed meanwhile; anything else 4xx can never succeed. */
function outcomeOfError(err) {
  const status = err?.status ?? err?.statusCode;
  if (!status || status >= 500) return null;
  if (status === 409 && err.code !== 'IDEMPOTENCY_KEY_REUSED') return SYNC_OUTCOME.CONFLICT;
  return SYNC_OUTCOME.REJECTED;
}

function toPublic(doc, replayed = false) {
  return {
    eventId: doc.eventId,
    type: doc.type,
    outcome: replayed ? SYNC_OUTCOME.DUPLICATE : doc.outcome,
    ...(replayed ? { originalOutcome: doc.outcome } : {}),
    result: doc.result ?? null,
    error: doc.error?.code ? { code: doc.error.code, message: doc.error.message } : null,
    recordedAt: doc.recordedAt,
    receivedAt: doc.receivedAt,
  };
}

async function processOne(event, { deviceId, actor, requestId }) {
  const seen = await SyncEvent.findOne({ eventId: event.eventId }).lean();
  if (seen) {
    if (String(seen.actorId) !== actor.id) {
      return { eventId: event.eventId, type: event.type, outcome: SYNC_OUTCOME.REJECTED, result: null, error: failure('CONFLICT', 'This eventId belongs to another user.') };
    }
    return toPublic(seen, true);
  }

  const handler = SYNC_HANDLERS[event.type];
  let outcome;
  let result = null;
  let error = null;
  if (!handler.roles.includes(actor.role)) {
    outcome = SYNC_OUTCOME.REJECTED;
    error = failure('FORBIDDEN', 'Your role cannot perform this action.');
  } else {
    const parsed = parsePayload(event.type, event.payload, actor);
    if (!parsed.success) {
      outcome = SYNC_OUTCOME.REJECTED;
      error = failure('VALIDATION_ERROR', 'The recorded data is not valid.', parsed.issues);
    } else {
      try {
        const context = { actor, requestId, idempotencyKey: event.eventId, source: 'OFFLINE' };
        const applied = await handler.apply(parsed.id, parsed.body, context);
        outcome = SYNC_OUTCOME.APPLIED;
        result = applied.body ?? null;
      } catch (err) {
        outcome = outcomeOfError(err);
        if (!outcome) {
          return { eventId: event.eventId, type: event.type, outcome: 'RETRY', result: null, error: failure('SERVICE_UNAVAILABLE', 'Could not process this event now; it will be sent again.') };
        }
        error = failure(err.code ?? 'ERROR', err.message, err.details);
      }
    }
  }

  try {
    const doc = await SyncEvent.create({
      eventId: event.eventId,
      deviceId,
      actorId: actor.id,
      actorRole: actor.role,
      type: event.type,
      payload: event.payload ?? null,
      recordedAt: event.recordedAt,
      outcome,
      result: result ? JSON.parse(JSON.stringify(result)) : null,
      error: error ? { code: error.code, message: error.message } : undefined,
    });
    return { ...toPublic(doc.toObject()), ...(error?.details ? { error } : {}) };
  } catch (err) {
    // The same eventId arrived twice at once: the other request recorded it first.
    if (err?.code === 11000) return toPublic(await SyncEvent.findOne({ eventId: event.eventId }).lean(), true);
    throw err;
  }
}

/** Replays a batch in the order the actions happened on the device. */
export async function syncEvents({ deviceId, events }, { actor, requestId }) {
  const ordered = [...events].sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
  const results = [];
  for (const [index, event] of ordered.entries()) {
    const result = await processOne(event, { deviceId, actor, requestId });
    results.push(result);
    // Later events may depend on this one (pause, then resume): never apply them out of order.
    if (result.outcome === 'RETRY') {
      for (const later of ordered.slice(index + 1)) {
        results.push({ eventId: later.eventId, type: later.type, outcome: 'RETRY', result: null, error: failure('NOT_PROCESSED', 'Not processed because an earlier action must be sent first.') });
      }
      break;
    }
  }
  const counts = Object.fromEntries([...Object.values(SYNC_OUTCOME), 'RETRY'].map((o) => [o, results.filter((r) => r.outcome === o).length]));
  return { results, counts };
}

/** The caller's sync history (ADMIN: everyone's), newest first; e.g. to review conflicts. */
export async function listSyncEvents({ outcome, deviceId, page, limit }, actor) {
  const filter = {};
  if (actor.role !== ROLES.ADMIN) filter.actorId = actor.id;
  if (outcome) filter.outcome = outcome;
  if (deviceId) filter.deviceId = deviceId;
  const [docs, total] = await Promise.all([
    SyncEvent.find(filter, { payload: 0 }).sort({ receivedAt: -1, _id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    SyncEvent.countDocuments(filter),
  ]);
  return { events: docs.map((d) => ({ ...toPublic(d), deviceId: d.deviceId, actorRole: d.actorRole })), meta: { page, limit, total } };
}
