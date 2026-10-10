// Order feasibility (Phase 6). The verdict is derived from explicit checks, never a black box:
// every check says what it compared and why it passed or failed.
export const FEASIBILITY_STATUS = Object.freeze({
  FEASIBLE: 'FEASIBLE',
  NOT_FEASIBLE: 'NOT_FEASIBLE',
});

export const FEASIBILITY_CHECK = Object.freeze({
  MATERIAL: 'MATERIAL',
  DEADLINE: 'DEADLINE',
  // Needs machines, production rates and workload (Phase 7/8); reported, not yet evaluated.
  MACHINE_CAPACITY: 'MACHINE_CAPACITY',
});

export const CHECK_RESULT = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  NOT_ASSESSED: 'NOT_ASSESSED',
});
