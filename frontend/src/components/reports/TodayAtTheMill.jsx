import { Link } from 'react-router-dom';
import { reportsApi } from '../../api/endpoints.js';
import { useApiQuery } from '../../hooks/useApiQuery.js';
import { liveMatch, useLive } from '../../realtime/realtimeBus.js';
import { formatNumber } from '../../utils/format.js';

/**
 * Today at the mill (admin, floor manager): output, quality decisions, dispatch, attendance and
 * problems, from what was recorded today. Loads on its own: if it fails, the dashboard still works.
 */
export function TodayAtTheMill() {
  const today = useApiQuery(() => reportsApi.today(), []);
  useLive(liveMatch.actions('ROLL_', 'QC_', 'DISPATCH_', 'ATTENDANCE_', 'MACHINE_'), today.reload);
  const t = today.data;
  if (!t) return null;
  return (
    <div className="erp-card section-gap" aria-label="Today at the mill">
      <div className="card-header">
        <div>
          <h3 className="card-title">Today at the mill</h3>
          <p className="card-subtitle">From what was recorded today ({t.date}).</p>
        </div>
        <Link className="erp-btn-outline erp-btn-sm" to="/production-report">Production report</Link>
      </div>
      <ul className="plain-list">
        <li>Produced <strong>{formatNumber(t.producedMetres, 'm')}</strong> in {t.rolls} roll(s) · {t.machinesRunning} machine(s) running now</li>
        <li>Quality: {t.inspections.pass} passed, {t.inspections.rework} sent to rework, {t.inspections.reject} rejected</li>
        <li>Dispatched {formatNumber(t.dispatchedMetres, 'm')} in {t.dispatches} dispatch(es)</li>
        <li>Attendance: {t.attendance.present} present, {t.attendance.halfDay} half day, {t.attendance.absent} absent</li>
        <li>Machine problems reported today: {t.problemsReported}</li>
      </ul>
    </div>
  );
}
