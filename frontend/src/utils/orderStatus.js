// The backend's order lifecycle (docs/DATABASE.md). Only ORDER_CREATED → CANCELLED / REJECTED is
// implemented today; later stages are shown as upcoming, never as done.
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

export function isOpenOrder(order) {
  return !TERMINAL.includes(order.status);
}
