import {
  MACHINE_STATUS_LABELS,
  MACHINE_STATUS_TONES,
  QC_RESULT_LABELS,
  QC_RESULT_TONES,
  ROLL_STATUS_LABELS,
  ROLL_STATUS_TONES,
  RUN_STATUS_LABELS,
  RUN_STATUS_TONES,
} from '../../utils/machineStatus.js';

export function MachineStatusBadge({ status }) {
  return <span className={`erp-status-badge ${MACHINE_STATUS_TONES[status] ?? 'neutral'}`}>{MACHINE_STATUS_LABELS[status] ?? status}</span>;
}

export function RunStatusBadge({ status }) {
  return <span className={`erp-status-badge ${RUN_STATUS_TONES[status] ?? 'neutral'}`}>{RUN_STATUS_LABELS[status] ?? status}</span>;
}

export function RollStatusBadge({ status }) {
  return <span className={`erp-status-badge ${ROLL_STATUS_TONES[status] ?? 'neutral'}`}>{ROLL_STATUS_LABELS[status] ?? status}</span>;
}

export function QcResultBadge({ result }) {
  return <span className={`erp-status-badge ${QC_RESULT_TONES[result] ?? 'neutral'}`}>{QC_RESULT_LABELS[result] ?? result}</span>;
}
