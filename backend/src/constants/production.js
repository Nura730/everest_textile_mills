// Machine types (docs/DATABASE.md, D3: single-stage production). A product names the machine type
// that makes it, so feasibility can later match orders to machines.
export const MACHINE_TYPES = Object.freeze(['SPINNING', 'WEAVING', 'DYEING', 'FINISHING']);

export const WEAVES = Object.freeze(['PLAIN', 'TWILL', 'SATIN', 'DOBBY']);

// Production runs (Phase 8): one order on one machine of the product's type (D3: single stage).
export const RUN_STATUS = Object.freeze({
  PLANNED: 'PLANNED',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
});

export const ALL_RUN_STATUSES = Object.freeze(Object.values(RUN_STATUS));

/** Runs that still hold their machine and count towards the order's planned quantity. */
export const OPEN_RUN_STATUSES = Object.freeze([RUN_STATUS.PLANNED, RUN_STATUS.RUNNING, RUN_STATUS.PAUSED]);

/** Roll lifecycle (docs/DATABASE.md). Phase 8 creates rolls as QC_PENDING; QC (Phase 10) moves them on. */
export const ROLL_STATUS = Object.freeze({
  QC_PENDING: 'QC_PENDING',
  QC_PASSED: 'QC_PASSED',
  IN_REWORK: 'IN_REWORK',
  REJECTED: 'REJECTED',
  FINISHED: 'FINISHED',
});
