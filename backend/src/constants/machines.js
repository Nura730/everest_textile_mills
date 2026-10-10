// Machine states (docs/DATABASE.md, decision D4 confirmed: no IDLE; ASSIGNED = a run is booked but
// not started). ASSIGNED, RUNNING and PAUSED are entered by production runs (Phase 8).
export const MACHINE_STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  ASSIGNED: 'ASSIGNED',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  DOWN: 'DOWN',
  MAINTENANCE: 'MAINTENANCE',
});

export const ALL_MACHINE_STATUSES = Object.freeze(Object.values(MACHINE_STATUS));

/** States in which a machine can never start a production run (instruction.md §32, Phase 5). */
export const CANNOT_RUN_STATUSES = Object.freeze([MACHINE_STATUS.DOWN, MACHINE_STATUS.MAINTENANCE]);

/** Statuses a critical problem can take DOWN (a DOWN machine just collects more problems). */
export const CAN_GO_DOWN_FROM = Object.freeze([
  MACHINE_STATUS.AVAILABLE,
  MACHINE_STATUS.ASSIGNED,
  MACHINE_STATUS.RUNNING,
  MACHINE_STATUS.PAUSED,
  MACHINE_STATUS.MAINTENANCE,
]);

/**
 * Where a machine goes when its last critical problem is resolved. A running run cannot simply
 * carry on unattended, so RUNNING comes back as PAUSED (the floor manager resumes it, Phase 8);
 * a machine that was in maintenance comes back AVAILABLE (the problem was the reason it stopped).
 */
export function statusAfterRepair(statusBeforeDown) {
  if (statusBeforeDown === MACHINE_STATUS.RUNNING || statusBeforeDown === MACHINE_STATUS.PAUSED) return MACHINE_STATUS.PAUSED;
  if (statusBeforeDown === MACHINE_STATUS.ASSIGNED) return MACHINE_STATUS.ASSIGNED;
  return MACHINE_STATUS.AVAILABLE;
}

export const PROBLEM_CATEGORIES = Object.freeze(['MECHANICAL', 'ELECTRICAL', 'MATERIAL', 'QUALITY', 'OTHER']);
export const PROBLEM_SEVERITIES = Object.freeze(['LOW', 'MEDIUM', 'CRITICAL']);

export const MACHINE_EVENT_TYPES = Object.freeze([
  'STATUS_CHANGED',
  'PROBLEM_REPORTED',
  'PROBLEM_RESOLVED',
  'MAINTENANCE_STARTED',
  'MAINTENANCE_ENDED',
]);
