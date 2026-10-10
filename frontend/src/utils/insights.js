import { formatDate } from './format.js';

/** One-line delivery estimate: "Needs ~17 day(s), 10 day(s) left · finish ~28 Oct 2026". */
export function estimateText(risk) {
  if (risk.daysNeeded === null) return 'No estimate: no machine can take the work yet';
  const left = risk.daysLeft < 0 ? `${-risk.daysLeft} day(s) overdue` : `${risk.daysLeft} day(s) left`;
  return `Needs ~${risk.daysNeeded} day(s), ${left} · finish ~${formatDate(risk.expectedFinish)}`;
}
