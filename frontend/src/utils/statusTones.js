// The one place where a business state becomes a colour (a "tone"). Every status badge in the live app
// reads from here, so the same state always looks the same. The tone follows the RECORDED state:
//   success  completed, passed, available, verified
//   warning  pending, waiting for someone, on hold, attention needed
//   danger   failed, rejected, blocked, down, overdue
//   info     in progress, active workflow
//   neutral  planned, inactive, cancelled, not started
// Machines use the factory floor's own colours (one mapping for the floor map, badges and cards):
//   running (green) · idle (yellow: available, assigned not started, paused) · maintenance (orange)
//   · down (red: not working; also retired machines, out of service)
// Colour is never the only signal: <StatusBadge> always shows an icon and the text label too.

export const TONES = Object.freeze({
  ORDER: {
    ORDER_CREATED: 'warning', // waiting for the factory to confirm
    CONFIRMED: 'info',
    MATERIAL_RESERVED: 'info',
    IN_PRODUCTION: 'info',
    PRODUCTION_COMPLETED: 'info',
    READY_FOR_DISPATCH: 'info',
    DISPATCHED: 'success',
    INVOICED: 'success',
    CANCELLED: 'neutral',
    REJECTED: 'danger',
  },
  MACHINE: { RUNNING: 'running', AVAILABLE: 'idle', ASSIGNED: 'idle', PAUSED: 'idle', MAINTENANCE: 'maintenance', DOWN: 'down', OUT_OF_SERVICE: 'down' },
  RUN: { PLANNED: 'neutral', RUNNING: 'info', PAUSED: 'warning', COMPLETED: 'success', CANCELLED: 'neutral' },
  ROLL: { QC_PENDING: 'warning', IN_REWORK: 'warning', QC_PASSED: 'success', FINISHED: 'success', REJECTED: 'danger' },
  QC_RESULT: { PASS: 'success', REWORK: 'warning', REJECT: 'danger' },
  DISPATCH: { PREPARED: 'warning', CONFIRMED: 'success', CANCELLED: 'neutral' },
  DELIVERY: { IN_TRANSIT: 'info', DELIVERED: 'warning', DISCREPANCY: 'danger', VERIFIED: 'success' },
  FINISHED_GOOD: { IN_STOCK: 'success', RESERVED_FOR_DISPATCH: 'info', DISPATCHED: 'neutral' },
  RISK: { ON_TRACK: 'success', AT_RISK: 'warning', LATE: 'danger' },
  SEVERITY: { LOW: 'neutral', MEDIUM: 'warning', CRITICAL: 'danger', MINOR: 'neutral', MAJOR: 'warning', HIGH: 'danger' },
  SYNC: { PENDING: 'warning', SYNCING: 'info', FAILED: 'danger', CONFLICT: 'danger', REJECTED: 'danger' },
  PRIORITY: { HIGH: 'danger', MEDIUM: 'warning', LOW: 'info' },
});

/** The tone of a state in a domain; unknown states are neutral, never "success". */
export function toneOf(domain, state) {
  return TONES[domain]?.[state] ?? 'neutral';
}
