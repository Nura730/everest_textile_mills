import { z } from 'zod';
import { ROLES } from '../constants/roles.js';
import { SYNC_OUTCOME, SyncEvent } from '../models/SyncEvent.js';
import { reportProblemBodySchema } from '../validators/machine.validators.js';
import { reasonBodySchema, recordRollBodySchema } from '../validators/production.validators.js';
import { inspectRollBodySchema, reworkDoneBodySchema } from '../validators/quality.validators.js';
import { objectIdSchema } from '../validators/common.validators.js';
import * as machines from './machine.service.js';
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
 * Offline actions are the floor and QC ones from the plan: production pause/resume, recording a roll,
 * reporting a machine problem, QC inspection (signature captured on the device), finishing rework.
 */

const FLOOR = [ROLES.FLOOR_MANAGER, ROLES.ADMIN];
const QC = [ROLES.QC_INSPECTOR, ROLES.ADMIN];

const runRef = z.object({ runId: objectIdSchema });
const rollRef = z.object({ rollId: objectIdSchema });
const machineRef = z.object({ machineId: objectIdSchema });

/** type → { roles, payload schema, apply(payload, context) } */
export const SYNC_HANDLERS = Object.freeze({
  RUN_PAUSE: {
    roles: FLOOR,
    schema: runRef.extend(reasonBodySchema.shape).strict(),
    apply: ({ runId, ...body }, context) => production.pauseRun(runId, body, context),
  },
  RUN_RESUME: {
    roles: FLOOR,
    schema: runRef.strict(),
    apply: ({ runId }, context) => production.resumeRun(runId, context),
  },
  ROLL_RECORD: {
    roles: FLOOR,
    schema: runRef.extend(recordRollBodySchema.shape).strict(),
    apply: ({ runId, ...body }, context) => production.recordRoll(runId, body, context),
  },
  MACHINE_PROBLEM_REPORT: {
    roles: FLOOR,
    schema: machineRef.extend(reportProblemBodySchema.shape).strict(),
    apply: ({ machineId, ...body }, context) => machines.reportProblem(machineId, body, context),
  },
  QC_INSPECT: {
    roles: QC,
    schema: rollRef.extend(inspectRollBodySchema.shape).strict(),
    apply: ({ rollId, ...body }, context) => quality.inspectRoll(rollId, body, context),
  },
  REWORK_DONE: {
    roles: FLOOR,
    schema: rollRef.extend(reworkDoneBodySchema.shape).strict(),
    apply: ({ rollId, ...body }, context) => quality.completeRework(rollId, body, context),
  },
});
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
    const parsed = handler.schema.safeParse(event.payload);
    if (!parsed.success) {
      outcome = SYNC_OUTCOME.REJECTED;
      error = failure('VALIDATION_ERROR', 'The recorded data is not valid.', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    } else {
      try {
        const context = { actor, requestId, idempotencyKey: event.eventId, source: 'OFFLINE' };
        const applied = await handler.apply(parsed.data, context);
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
  for (const event of ordered) results.push(await processOne(event, { deviceId, actor, requestId }));
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
