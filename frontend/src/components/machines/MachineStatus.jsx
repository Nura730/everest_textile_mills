import { MACHINE_STATUS_LABELS, QC_RESULT_LABELS, ROLL_STATUS_LABELS, RUN_STATUS_LABELS } from '../../utils/machineStatus.js';
import { StatusBadge } from '../ui/StatusBadge.jsx';

// Colours come from the central tone map (utils/statusTones.js); every badge shows icon + text.
export function MachineStatusBadge({ status }) {
  return <StatusBadge domain="MACHINE" state={status} label={MACHINE_STATUS_LABELS[status] ?? status} />;
}

export function RunStatusBadge({ status }) {
  return <StatusBadge domain="RUN" state={status} label={RUN_STATUS_LABELS[status] ?? status} />;
}

export function RollStatusBadge({ status }) {
  return <StatusBadge domain="ROLL" state={status} label={ROLL_STATUS_LABELS[status] ?? status} title={status === 'IN_REWORK' ? 'On quality hold until rework is done' : undefined} />;
}

export function QcResultBadge({ result }) {
  return <StatusBadge domain="QC_RESULT" state={result} label={QC_RESULT_LABELS[result] ?? result} />;
}
