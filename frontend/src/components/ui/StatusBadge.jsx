import { AlertTriangle, CheckCircle2, Circle, CircleDot, XCircle } from 'lucide-react';
import { toneOf } from '../../utils/statusTones.js';

const ICON = { success: CheckCircle2, warning: AlertTriangle, danger: XCircle, info: CircleDot, neutral: Circle };

/**
 * One status badge for the whole app: colour from the central tone map (utils/statusTones.js), plus
 * an icon and the text label, so the state is clear without colour.
 * Use either `domain` + `state` (looked up), or an explicit `tone`.
 */
export function StatusBadge({ domain, state, tone, label, title }) {
  const t = tone ?? toneOf(domain, state);
  const Icon = ICON[t] ?? Circle;
  return (
    <span className={`status-badge tone-${t}`} title={title}>
      <Icon size={12} aria-hidden="true" />
      <span>{label ?? state}</span>
    </span>
  );
}
