// The backend's order lifecycle (docs/DATABASE.md). Implemented today: ORDER_CREATED → CONFIRMED /
// CANCELLED / REJECTED and CONFIRMED → CANCELLED; later stages are shown as upcoming, never as done.
export const ORDER_STEPS = [
  { status: 'ORDER_CREATED', label: 'Order created' },
  { status: 'CONFIRMED', label: 'Confirmed' },
  { status: 'MATERIAL_RESERVED', label: 'Yarn reserved' },
  { status: 'IN_PRODUCTION', label: 'In production' },
  { status: 'PRODUCTION_COMPLETED', label: 'Production done' },
  { status: 'READY_FOR_DISPATCH', label: 'Ready for dispatch' },
  { status: 'DISPATCHED', label: 'Dispatched' },
  { status: 'INVOICED', label: 'Invoiced' },
];

export const STATUS_LABELS = {
  ...Object.fromEntries(ORDER_STEPS.map((step) => [step.status, step.label])),
  CANCELLED: 'Cancelled',
  REJECTED: 'Rejected',
};

const TERMINAL = ['CANCELLED', 'REJECTED', 'INVOICED'];

/**
 * INVOICED is the last stage of the lifecycle: the server only reaches it when every roll was produced,
 * dispatched, its delivery verified and invoiced. So an invoiced order is COMPLETE, not "in progress".
 */
export const isCompletedOrder = (order) => order.status === 'INVOICED';

/**
 * The state of each progress step, from the persisted status history only:
 * 'done' | 'current' | 'upcoming' | 'stopped' (the last stage a cancelled/rejected order reached).
 */
export function stepStates(order) {
  const reached = new Set((order.statusHistory ?? []).map((change) => change.to));
  const stopped = order.status === 'CANCELLED' || order.status === 'REJECTED';
  const completed = isCompletedOrder(order);
  const currentIndex = ORDER_STEPS.findIndex((step) => step.status === order.status);
  const lastReachedIndex = Math.max(...ORDER_STEPS.map((step, index) => (reached.has(step.status) ? index : -1)));
  return ORDER_STEPS.map((step, index) => {
    let state = 'upcoming';
    if (index === currentIndex) state = completed ? 'done' : 'current';
    else if (reached.has(step.status) || (completed && index < currentIndex)) state = 'done';
    if (stopped && index === lastReachedIndex) state = 'stopped';
    return state;
  });
}

export function isOpenOrder(order) {
  return !TERMINAL.includes(order.status);
}
