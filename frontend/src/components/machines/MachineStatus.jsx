import { MACHINE_STATUS_LABELS, MACHINE_STATUS_TONES, RUN_STATUS_LABELS, RUN_STATUS_TONES } from '../../utils/machineStatus.js';

export function MachineStatusBadge({ status }) {
  return <span className={`erp-status-badge ${MACHINE_STATUS_TONES[status] ?? 'neutral'}`}>{MACHINE_STATUS_LABELS[status] ?? status}</span>;
}

export function RunStatusBadge({ status }) {
  return <span className={`erp-status-badge ${RUN_STATUS_TONES[status] ?? 'neutral'}`}>{RUN_STATUS_LABELS[status] ?? status}</span>;
}
