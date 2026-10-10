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
