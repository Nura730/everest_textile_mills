import { recordAudit } from '../audit/recordAudit.js';
import {
  CAN_GO_DOWN_FROM,
  MACHINE_STATUS,
  statusAfterRepair,
} from '../constants/machines.js';
import { toPublicMachine } from '../models/Machine.js';
import { toPublicMachineEvent } from '../models/MachineEvent.js';
import { RUN_STATUS } from '../constants/production.js';
import { claimLock } from '../repositories/locks.repository.js';
import { transitionRunGuarded } from '../repositories/production.repository.js';
import {
  appendMachineEvent,
  findCriticalProblemsWithResolution,
  findMachineById,
  findMachineEventById,
  findMachineEventsPage,
  findMachinesPage,
  findOpenProblems,
  insertMachine,
  transitionMachineGuarded,
  updateMachineIfUnchanged,
} from '../repositories/machine.repository.js';
import { AppError } from '../utils/AppError.js';
import { diffFields, isStale, staleEditConflict } from '../utils/edits.js';
import { runInTransaction } from '../utils/transaction.js';
import { metresToCm } from '../utils/units.js';
import { executeIdempotent } from './idempotency.service.js';

/*
 * Phase 7: machine registry, status rules, problems and maintenance (docs/DATABASE.md, D4).
 *
 *   AVAILABLE ──start maintenance──▶ MAINTENANCE ──end maintenance──▶ AVAILABLE
 *   AVAILABLE/ASSIGNED/RUNNING/PAUSED/MAINTENANCE ──critical problem──▶ DOWN
 *   DOWN ──last critical problem resolved──▶ where it was (RUNNING/PAUSED come back PAUSED)
 *   RUNNING ──problem with "pause production"──▶ PAUSED
 *   Low/medium problems are recorded and stay open; the status does not change.
 *
 * Every change: guarded status update + append-only MachineEvent + audit entry, in one transaction,
 * under a per-machine lock so two actions on one machine are applied one after the other (e.g. two
 * critical problems resolved at the same moment cannot both think the other is still open).
 * ASSIGNED, RUNNING and PAUSED are entered by production runs (Phase 8).
 */

const notFound = () => new AppError('NOT_FOUND', 'Machine not found');
const lockMachine = (id, session) => claimLock(`machine:${id}`, session);

function invalidTransition(machine, to, allowedFrom) {
  return new AppError('INVALID_STATE_TRANSITION', `A machine that is ${machine.status} cannot become ${to}`, {
    details: { from: machine.status, to, allowedFrom },
  });
}

async function loadActiveMachine(id, session) {
  const machine = await findMachineById(id, { session });
  if (!machine) throw notFound();
  if (!machine.isActive) throw new AppError('MACHINE_INACTIVE', `Machine ${machine.code} is retired`);
  return machine;
}

function eventBase(machine, context) {
  return { machineId: machine._id, actorId: context.actor.id, actorRole: context.actor.role, source: context.source ?? 'ONLINE' };
}

const auditFor = (action, machine, extra, context, session) =>
  recordAudit({ action, entityType: 'Machine', entityId: machine._id, machineId: machine._id, ...extra }, context, session);

// ── Registry ────────────────────────────────────────────────────────────────────

export function createMachine({ ratedMetresPerHour, ...input }, context) {
  return runInTransaction(async (session) => {
    const machine = await insertMachine({ ...input, ratedCmPerHour: metresToCm(ratedMetresPerHour), createdBy: context.actor.id }, session);
    await auditFor('MACHINE_CREATED', machine, { after: { code: machine.code, type: machine.type, ratedCmPerHour: machine.ratedCmPerHour } }, context, session);
    return toPublicMachine(machine);
  });
}

function countBy(events, keyOf) {
  const counts = new Map();
  for (const event of events) counts.set(keyOf(event), (counts.get(keyOf(event)) ?? 0) + 1);
  return counts;
}

export async function listMachines({ type, status, q, isActive, page, limit }) {
  const { machines, total } = await findMachinesPage({ type, status, q, isActive }, { page, limit });
  const open = await findOpenProblems(machines.map((machine) => machine._id));
  const openCount = countBy(open, (event) => String(event.machineId));
  return {
    machines: machines.map((machine) => ({ ...toPublicMachine(machine), openProblems: openCount.get(String(machine._id)) ?? 0 })),
    meta: { page, limit, total },
  };
}

/**
 * Downtime from critical problems (reported -> resolved; still-open ones count up to now), in minutes.
 * Pure over the problem list, so it is easy to verify.
 */
export function downtimeMinutes(problems, now = new Date()) {
  return problems.reduce((sum, { reported, resolved }) => {
    const end = resolved ? resolved.occurredAt : now;
    return sum + Math.max(0, Math.round((end - reported.occurredAt) / 60000));
  }, 0);
}

export async function getMachine(id) {
  const machine = await findMachineById(id);
  if (!machine) throw notFound();
  const [open, critical] = await Promise.all([findOpenProblems([machine._id]), findCriticalProblemsWithResolution(machine._id)]);
  return {
    machine: toPublicMachine(machine),
    openProblems: open.map((event) => toPublicMachineEvent(event)),
    downtime: {
      criticalProblems: critical.length,
      totalMinutes: downtimeMinutes(critical),
      ongoing: critical.some((problem) => !problem.resolved),
    },
  };
}

export async function getMachineEvents(id, { type, from, to, page, limit }) {
  const machine = await findMachineById(id);
  if (!machine) throw notFound();
  const { events, total } = await findMachineEventsPage(machine._id, { type, from, to }, { page, limit });
  return { events: events.map((event) => toPublicMachineEvent(event)), meta: { page, limit, total } };
}

/** Name, rated speed and location (ADMIN). Code and type identify the machine and are locked. */
export function updateMachine(id, { expectedUpdatedAt, ratedMetresPerHour, ...changes }, context) {
  return runInTransaction(async (session) => {
    const machine = await findMachineById(id, { session });
    if (!machine) throw notFound();
    const diff = diffFields(machine, { ...changes, ratedCmPerHour: ratedMetresPerHour === undefined ? undefined : metresToCm(ratedMetresPerHour) });
    if (!diff) return toPublicMachine(machine);
    if (isStale(machine, expectedUpdatedAt)) throw staleEditConflict('machine');
    const updated = await updateMachineIfUnchanged(machine._id, machine.updatedAt, diff.after, session);
    if (!updated) throw staleEditConflict('machine');
    await auditFor('MACHINE_UPDATED', machine, diff, context, session);
    return toPublicMachine(updated);
  });
}

/**
 * Retire or reactivate (ADMIN). A machine with work booked or running (ASSIGNED/RUNNING/PAUSED)
 * cannot be retired; DOWN or MAINTENANCE machines can (a retired machine keeps its history).
 */
export function setMachineActive(id, { isActive }, context) {
  return runInTransaction(async (session) => {
    await lockMachine(id, session);
    const machine = await findMachineById(id, { session });
    if (!machine) throw notFound();
    if (machine.isActive === isActive) return toPublicMachine(machine);
    if (!isActive && [MACHINE_STATUS.ASSIGNED, MACHINE_STATUS.RUNNING, MACHINE_STATUS.PAUSED].includes(machine.status)) {
      throw new AppError('CONFLICT', `Machine ${machine.code} has production booked or running (${machine.status}); finish or move it first`, {
        details: { status: machine.status },
      });
    }
    const updated = await updateMachineIfUnchanged(machine._id, machine.updatedAt, { isActive }, session);
    if (!updated) throw staleEditConflict('machine');
    await auditFor('MACHINE_ACTIVE_CHANGED', machine, { before: { isActive: machine.isActive }, after: { isActive } }, context, session);
    return toPublicMachine(updated);
  });
}

// ── Status actions (FLOOR_MANAGER, ADMIN; Idempotency-Key) ──────────────────────

/** Shared shape: lock, load, check, guarded transition, event, audit. */
function machineAction({ id, operation, request, context }, work) {
  return executeIdempotent({ context, operation, request: { id, ...request } }, async (session) => {
    await lockMachine(id, session);
    const machine = await loadActiveMachine(id, session);
    const result = await work(machine, session);
    const fresh = await findMachineById(machine._id, { session });
    return { statusCode: result?.statusCode ?? 200, body: { machine: toPublicMachine(fresh), ...(result?.body ?? {}) } };
  });
}

async function moveStatus(machine, to, set, session) {
  const updated = await transitionMachineGuarded(machine._id, machine.status, { status: to, ...set }, session);
  if (!updated) throw new AppError('CONFLICT', 'The machine changed meanwhile. Reload and try again.');
  return updated;
}

export const startMaintenance = (id, { note }, context) =>
  machineAction({ id, operation: 'MACHINE_MAINTENANCE_START', request: { note }, context }, async (machine, session) => {
    if (machine.status !== MACHINE_STATUS.AVAILABLE) throw invalidTransition(machine, MACHINE_STATUS.MAINTENANCE, [MACHINE_STATUS.AVAILABLE]);
    await moveStatus(machine, MACHINE_STATUS.MAINTENANCE, {}, session);
    const event = await appendMachineEvent(
      { ...eventBase(machine, context), type: 'MAINTENANCE_STARTED', fromStatus: machine.status, toStatus: MACHINE_STATUS.MAINTENANCE, note: note ?? null },
      session,
    );
    await auditFor('MACHINE_MAINTENANCE_STARTED', machine, { before: { status: machine.status }, after: { status: MACHINE_STATUS.MAINTENANCE, note: note ?? null } }, context, session);
    return { body: { event: toPublicMachineEvent(event) } };
  });

/**
 * Finish maintenance and record its cost once (on the MAINTENANCE_ENDED event, append-only). A retried
 * request replays the stored result, so the cost is never recorded twice. Maintenance cost is a
 * machine/factory expense: it is reported separately and never spread over orders (no allocation rule).
 */
export const endMaintenance = (id, { note, costPaise }, context) =>
  machineAction({ id, operation: 'MACHINE_MAINTENANCE_END', request: { note, costPaise }, context }, async (machine, session) => {
    if (machine.status !== MACHINE_STATUS.MAINTENANCE) throw invalidTransition(machine, MACHINE_STATUS.AVAILABLE, [MACHINE_STATUS.MAINTENANCE]);
    await moveStatus(machine, MACHINE_STATUS.AVAILABLE, {}, session);
    const event = await appendMachineEvent(
      { ...eventBase(machine, context), type: 'MAINTENANCE_ENDED', fromStatus: machine.status, toStatus: MACHINE_STATUS.AVAILABLE, note: note ?? null, costPaise },
      session,
    );
    await auditFor('MACHINE_MAINTENANCE_ENDED', machine, { before: { status: machine.status }, after: { status: MACHINE_STATUS.AVAILABLE, note: note ?? null, costPaise } }, context, session);
    return { body: { event: toPublicMachineEvent(event) } };
  });

/**
 * Report a problem. CRITICAL takes the machine DOWN (remembering where it was). LOW/MEDIUM are
 * recorded and stay open without changing the status, unless "pause production" is asked for on a
 * RUNNING machine, which pauses it.
 */
export const reportProblem = (id, { category, severity, description, estimatedDowntimeMinutes, pauseProduction }, context) =>
  machineAction(
    { id, operation: 'MACHINE_PROBLEM_REPORT', request: { category, severity, description, estimatedDowntimeMinutes, pauseProduction }, context },
    async (machine, session) => {
      let to = machine.status;
      let set = {};
      if (severity === 'CRITICAL') {
        if (machine.status !== MACHINE_STATUS.DOWN) {
          if (!CAN_GO_DOWN_FROM.includes(machine.status)) throw invalidTransition(machine, MACHINE_STATUS.DOWN, CAN_GO_DOWN_FROM);
          to = MACHINE_STATUS.DOWN;
          set = { statusBeforeDown: machine.status };
        }
      } else if (pauseProduction) {
        if (machine.status !== MACHINE_STATUS.RUNNING) throw invalidTransition(machine, MACHINE_STATUS.PAUSED, [MACHINE_STATUS.RUNNING]);
        to = MACHINE_STATUS.PAUSED;
      }
      if (to !== machine.status) await moveStatus(machine, to, set, session);
      // A stopped machine stops its run: the run is paused too (resumed by a person after repair).
      if (machine.status === MACHINE_STATUS.RUNNING && to !== MACHINE_STATUS.RUNNING && machine.currentRunId) {
        await transitionRunGuarded(
          machine.currentRunId,
          [RUN_STATUS.RUNNING],
          RUN_STATUS.PAUSED,
          { from: RUN_STATUS.RUNNING, to: RUN_STATUS.PAUSED, at: new Date(), by: context.actor.id, byRole: context.actor.role, reason: `Machine problem (${severity}): ${description}` },
          session,
        );
      }

      const event = await appendMachineEvent(
        {
          ...eventBase(machine, context),
          runId: machine.currentRunId ?? null,
          type: 'PROBLEM_REPORTED',
          fromStatus: machine.status,
          toStatus: to,
          problem: { category, severity, description, estimatedDowntimeMinutes: estimatedDowntimeMinutes ?? null },
        },
        session,
      );
      await auditFor(
        'MACHINE_PROBLEM_REPORTED',
        machine,
        { before: { status: machine.status }, after: { status: to, category, severity, problemEventId: String(event._id) } },
        context,
        session,
      );
      return { statusCode: 201, body: { event: toPublicMachineEvent(event) } };
    },
  );

/**
 * Resolve an open problem (once). When the last open CRITICAL problem of a DOWN machine is resolved,
 * the machine returns to where it was (statusAfterRepair). Resolution note required.
 */
export const resolveProblem = (id, problemEventId, { resolution }, context) =>
  machineAction({ id, operation: 'MACHINE_PROBLEM_RESOLVE', request: { problemEventId, resolution }, context }, async (machine, session) => {
    const problem = await findMachineEventById(problemEventId, { session });
    if (!problem || String(problem.machineId) !== String(machine._id) || problem.type !== 'PROBLEM_REPORTED') {
      throw new AppError('NOT_FOUND', 'Problem not found on this machine');
    }
    const stillOpen = await findOpenProblems([machine._id], { session });
    if (!stillOpen.some((event) => String(event._id) === String(problem._id))) {
      throw new AppError('PROBLEM_ALREADY_RESOLVED', 'This problem has already been resolved');
    }

    let to = machine.status;
    const otherCriticalOpen = stillOpen.some((event) => String(event._id) !== String(problem._id) && event.problem.severity === 'CRITICAL');
    if (machine.status === MACHINE_STATUS.DOWN && !otherCriticalOpen) {
      to = statusAfterRepair(machine.statusBeforeDown);
      await moveStatus(machine, to, { statusBeforeDown: null }, session);
    }

    const event = await appendMachineEvent(
      { ...eventBase(machine, context), type: 'PROBLEM_RESOLVED', fromStatus: machine.status, toStatus: to, resolvesEventId: problem._id, note: resolution },
      session,
    );
    await auditFor(
      'MACHINE_PROBLEM_RESOLVED',
      machine,
      { before: { status: machine.status }, after: { status: to, problemEventId: String(problem._id), resolution } },
      context,
      session,
    );
    return { body: { event: toPublicMachineEvent(event) } };
  });
