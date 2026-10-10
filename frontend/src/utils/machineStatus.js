// Machine states (backend constants/machines.js, decision D4: no IDLE).
export const MACHINE_STATUS_LABELS = {
  AVAILABLE: 'Available',
  ASSIGNED: 'Assigned',
  RUNNING: 'Running',
  PAUSED: 'Paused',
  DOWN: 'Down',
  MAINTENANCE: 'Maintenance',
};

export const MACHINE_TYPE_LABELS = { SPINNING: 'Spinning', WEAVING: 'Weaving', DYEING: 'Dyeing', FINISHING: 'Finishing' };

export const MACHINE_STATUS_TONES = { AVAILABLE: 'active', RUNNING: 'active', ASSIGNED: 'neutral', PAUSED: 'outline', MAINTENANCE: 'outline', DOWN: 'error' };

export const SEVERITY_TONES = { LOW: 'neutral', MEDIUM: 'outline', CRITICAL: 'error' };

// Production runs (backend constants/production.js).
export const RUN_STATUS_LABELS = { PLANNED: 'Planned', RUNNING: 'Running', PAUSED: 'Paused', COMPLETED: 'Completed', CANCELLED: 'Cancelled' };
export const RUN_STATUS_TONES = { PLANNED: 'neutral', RUNNING: 'active', PAUSED: 'outline', COMPLETED: 'active', CANCELLED: 'error' };

// Rolls and QC (backend constants/production.js, constants/quality.js).
export const ROLL_STATUS_LABELS = { QC_PENDING: 'Awaiting QC', QC_PASSED: 'QC passed', IN_REWORK: 'In rework', REJECTED: 'Rejected', FINISHED: 'Finished good' };
export const ROLL_STATUS_TONES = { QC_PENDING: 'outline', QC_PASSED: 'active', IN_REWORK: 'outline', REJECTED: 'error', FINISHED: 'active' };
export const QC_RESULT_LABELS = { PASS: 'Pass', REWORK: 'Rework', REJECT: 'Reject' };
export const QC_RESULT_TONES = { PASS: 'active', REWORK: 'outline', REJECT: 'error' };
export const DEFECT_LABELS = {
  COLOUR_MISMATCH: 'Colour mismatch',
  BROKEN_ENDS: 'Broken ends',
  BROKEN_PICKS: 'Broken picks',
  STAINS: 'Stains',
  HOLES: 'Holes',
  WIDTH_VARIATION: 'Width variation',
  GSM_VARIATION: 'GSM variation',
  WEAVE_FAULT: 'Weave fault',
  OTHER: 'Other',
};
