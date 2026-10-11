import { useState } from 'react';
import { Link } from 'react-router-dom';
import { reportsApi } from '../api/endpoints.js';
import { MachineStatusBadge } from '../components/machines/MachineStatus.jsx';
import { FilterBar, FilterDate } from '../components/ui/Filters.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { todayInIndia } from '../utils/attendance.js';
import { formatDate, formatNumber } from '../utils/format.js';
import { MACHINE_TYPE_LABELS } from '../utils/machineStatus.js';

const DEFECT_LABEL = (type) => type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, ' ');

/**
 * Production report (floor manager, QC, admin): what every machine produced today and in the chosen
 * period, output per shift and per day, and where defects come from. From recorded rolls and
 * inspections; no money.
 */
export default function ProductionReport() {
  const [today] = useState(todayInIndia);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const report = useApiQuery(() => reportsApi.production({ from, to }), [from, to]);
  const r = report.data;
  return (
    <div>
      <PageHeader title="Production report" subtitle="Output by machine, shift and day, and defects, from recorded rolls and inspections." breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Production report' }]} />
      <div className="erp-card">
        <FilterBar active={from !== monthStart || to !== today} onClear={() => { setFrom(monthStart); setTo(today); }} label="Report period">
          <FilterDate id="pr-from" label="From" value={from} max={to} onChange={(v) => setFrom(v || monthStart)} />
          <FilterDate id="pr-to" label="To" value={to} min={from} max={today} onChange={(v) => setTo(v || today)} />
        </FilterBar>
        {report.error && <ErrorState error={report.error} onRetry={report.reload} />}
        {!report.error && !r && <LoadingState />}
        {r && (
          <p className="card-subtitle">
            {formatDate(r.period.from)} – {formatDate(r.period.to)}: {formatNumber(r.totals.producedMetres, 'm')} in {r.totals.rolls} roll(s) · {r.totals.inspections} inspection(s), {r.totals.failedInspections} not passed
          </p>
        )}
      </div>
      {r && (
        <>
          <div className="erp-card section-gap">
            <h3 className="card-title">By machine</h3>
            <table className="erp-data-table">
              <thead>
                <tr><th scope="col">Machine</th><th scope="col">Type</th><th scope="col">Now</th><th scope="col" className="num">Today</th><th scope="col" className="num">Period</th><th scope="col" className="num">Rolls</th><th scope="col" className="num">Rejected</th><th scope="col" className="num">Defect rate</th><th scope="col" className="num">Maintenance downtime</th></tr>
              </thead>
              <tbody>
                {r.byMachine.map((m) => (
                  <tr key={m.machineId}>
                    <td><Link to={`/machines/${m.machineId}`} className="mono">{m.code}</Link> {m.name}</td>
                    <td>{MACHINE_TYPE_LABELS[m.type] ?? m.type}</td>
                    <td>{m.status === 'OUT_OF_SERVICE' ? 'Out of service' : <MachineStatusBadge status={m.status} />}</td>
                    <td className="num">{formatNumber(m.todayMetres, 'm')}</td>
                    <td className="num"><strong>{formatNumber(m.producedMetres, 'm')}</strong></td>
                    <td className="num">{m.rolls}</td>
                    <td className="num">{formatNumber(m.rejectedMetres, 'm')}</td>
                    <td className="num">{m.defectRatePercent === null ? '—' : `${m.defectRatePercent}% of ${m.inspections}`}</td>
                    <td className="num">{m.maintenanceDowntimeMinutes ? `${Math.round(m.maintenanceDowntimeMinutes / 6) / 10} h` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="erp-card section-gap">
            <h3 className="card-title">By shift</h3>
            <p className="card-subtitle">A roll counts in the shift during which it was recorded.</p>
            <table className="erp-data-table">
              <thead><tr><th scope="col">Shift</th><th scope="col">Hours</th><th scope="col" className="num">Rolls</th><th scope="col" className="num">Produced</th></tr></thead>
              <tbody>{r.byShift.map((s) => <tr key={s.shift}><td>{s.label}</td><td>{s.hours}</td><td className="num">{s.rolls}</td><td className="num">{formatNumber(s.producedMetres, 'm')}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="erp-card section-gap">
            <h3 className="card-title">By day</h3>
            {r.byDay.length === 0 ? <EmptyState title="No rolls recorded in this period" /> : (
              <table className="erp-data-table">
                <thead><tr><th scope="col">Day</th><th scope="col" className="num">Rolls</th><th scope="col" className="num">Produced</th></tr></thead>
                <tbody>{r.byDay.map((d) => <tr key={d.date}><td>{formatDate(d.date)}</td><td className="num">{d.rolls}</td><td className="num">{formatNumber(d.producedMetres, 'm')}</td></tr>)}</tbody>
              </table>
            )}
          </div>
          <div className="erp-card section-gap">
            <h3 className="card-title">Defects found</h3>
            {r.byDefectType.length === 0 ? <EmptyState title="No defects recorded in this period" /> : (
              <table className="erp-data-table">
                <thead><tr><th scope="col">Defect</th><th scope="col" className="num">Times found</th></tr></thead>
                <tbody>{r.byDefectType.map((d) => <tr key={d.type}><td>{DEFECT_LABEL(d.type)}</td><td className="num">{d.count}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
