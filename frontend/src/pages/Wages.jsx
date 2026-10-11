import { useState } from 'react';
import { workforceApi } from '../api/endpoints.js';
import { FilterBar, FilterDate, FilterSelect } from '../components/ui/Filters.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { DEPARTMENTS, DEPARTMENT_LABELS, WAGE_BASIS_LABELS, todayInIndia } from '../utils/attendance.js';
import { formatNumber, formatPaise } from '../utils/format.js';

/**
 * Wages for a period (admin), by department and by worker, computed by the server from the attendance
 * register. A factory labour expense, reported on its own and not spread over orders.
 */
export default function Wages() {
  const today = todayInIndia();
  const monthStart = `${today.slice(0, 7)}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [department, setDepartment] = useState('');
  const summary = useApiQuery(() => workforceApi.wageSummary({ from, to, ...(department ? { department } : {}) }), [from, to, department]);
  const s = summary.data;
  return (
    <div>
      <PageHeader title="Wages" subtitle="From the attendance register, computed by the server. A factory labour expense, not allocated to orders." breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Attendance', to: '/attendance' }, { label: 'Wages' }]} />
      <div className="erp-card">
        <FilterBar active={from !== monthStart || to !== today || department !== ''} onClear={() => { setFrom(monthStart); setTo(today); setDepartment(''); }} label="Wage filters">
          <FilterDate id="wg-from" label="From" value={from} max={to} onChange={(v) => setFrom(v || monthStart)} />
          <FilterDate id="wg-to" label="To" value={to} min={from} max={today} onChange={(v) => setTo(v || today)} />
          <FilterSelect id="wg-dept" label="Department" value={department} onChange={setDepartment} options={DEPARTMENTS.map((d) => ({ value: d, label: DEPARTMENT_LABELS[d] }))} />
        </FilterBar>
        {summary.error && <ErrorState error={summary.error} onRetry={summary.reload} />}
        {!summary.error && !s && <LoadingState />}
        {s && (
          <>
            <p className="card-subtitle">
              Total for {s.period.from} to {s.period.to}: <strong>{formatPaise(s.totalPaise)}</strong> · half day pays {s.halfDayFactorBp / 100}% of the daily rate
            </p>
            {s.byWorker.length === 0 ? (
              <EmptyState title="No attendance recorded in this period" />
            ) : (
              <>
                <h3 className="card-title section-gap">By department</h3>
                <table className="erp-data-table">
                  <thead><tr><th scope="col">Department</th><th scope="col" className="num">Workers</th><th scope="col" className="num">Present</th><th scope="col" className="num">Half days</th><th scope="col" className="num">Absent</th><th scope="col" className="num">Wages</th></tr></thead>
                  <tbody>
                    {s.byDepartment.map((d) => (
                      <tr key={d.department}><td>{DEPARTMENT_LABELS[d.department] ?? d.department}</td><td className="num">{d.workers}</td><td className="num">{d.present}</td><td className="num">{d.halfDay}</td><td className="num">{d.absent}</td><td className="num">{formatPaise(d.wagePaise)}</td></tr>
                    ))}
                  </tbody>
                </table>
                <h3 className="card-title section-gap">By worker</h3>
                <table className="erp-data-table">
                  <thead><tr><th scope="col">Worker</th><th scope="col">Department</th><th scope="col">Paid by</th><th scope="col" className="num">Present</th><th scope="col" className="num">Half days</th><th scope="col" className="num">Absent</th><th scope="col" className="num">Hours</th><th scope="col" className="num">Wages</th></tr></thead>
                  <tbody>
                    {s.byWorker.map((w) => (
                      <tr key={w.workerId}>
                        <td><span className="mono">{w.workerCode}</span> {w.workerName}</td>
                        <td>{DEPARTMENT_LABELS[w.department] ?? w.department}</td>
                        <td>{WAGE_BASIS_LABELS[w.wageBasis]}</td>
                        <td className="num">{w.present}</td><td className="num">{w.halfDay}</td><td className="num">{w.absent}</td>
                        <td className="num">{w.wageBasis === 'HOURLY' ? formatNumber(w.hours) : '—'}</td>
                        <td className="num">{formatPaise(w.wagePaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr><th scope="row" colSpan={7}>Total</th><td className="num"><strong>{formatPaise(s.totalPaise)}</strong></td></tr></tfoot>
                </table>
              </>
            )}
            <ul className="plain-list section-gap cell-sub">{s.rules.map((r) => <li key={r}>{r}</li>)}</ul>
          </>
        )}
      </div>
    </div>
  );
}
