import { useState } from 'react';
import { CheckSquare, XSquare, AlertCircle, FileText, Search, Download } from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { qualityInspections, defectTrendData } from '../data/mockData';

const resultFilters = ['All', 'Pass', 'Fail'];

const DefectTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        background: '#171717',
        color: '#fff',
        padding: '8px 12px',
        borderRadius: '6px',
        fontSize: '12px',
        border: 'none',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div style={{ color: '#a3a3a3' }}>{payload[0].value}% defect rate</div>
      </div>
    );
  }
  return null;
};

export default function QualityControl() {
  const [activeFilter, setActiveFilter] = useState('All');

  const filtered = qualityInspections.filter(qc => {
    if (activeFilter === 'All') return true;
    return qc.result === activeFilter;
  });

  const passCount = qualityInspections.filter(q => q.result === 'Pass').length;
  const failCount = qualityInspections.filter(q => q.result === 'Fail').length;
  const avgDefects = (qualityInspections.reduce((sum, q) => sum + q.defectsPerHundred, 0) / qualityInspections.length).toFixed(1);

  return (
    <div>
      <div className="page-header">
        <div className="page-header-info">
          <h1>Quality Control</h1>
          <p>Inspection results, defect tracking, and quality metrics</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary">
            <Download size={16} />
            Export Report
          </button>
          <button className="btn btn-primary">
            <FileText size={16} />
            New Inspection
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid-4" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="metric-card">
          <div className="metric-card-label">
            <CheckSquare size={16} />
            Total Inspections
          </div>
          <div className="metric-card-value">{qualityInspections.length}</div>
          <div className="metric-card-change">This month</div>
        </div>
        <div className="metric-card">
          <div className="metric-card-label">Passed</div>
          <div className="metric-card-value">{passCount}</div>
          <div className="metric-card-change">{((passCount / qualityInspections.length) * 100).toFixed(0)}% pass rate</div>
        </div>
        <div className={`metric-card ${failCount > 0 ? 'error' : ''}`}>
          <div className="metric-card-label">
            <XSquare size={16} />
            Failed
          </div>
          <div className="metric-card-value">{failCount}</div>
          <div className="metric-card-change" style={failCount > 0 ? { color: 'var(--color-error)' } : {}}>
            {failCount > 0 ? 'Requires rework' : 'No failures'}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-card-label">Avg Defects / 100m</div>
          <div className="metric-card-value">{avgDefects}</div>
          <div className="metric-card-change">Industry target: ≤ 2.5</div>
        </div>
      </div>

      {/* Defect Trend Chart */}
      <div className="card" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="card-header">
          <div>
            <div className="card-title">Defect Rate Trend</div>
            <div className="card-subtitle">Monthly average defects per 100 meters</div>
          </div>
        </div>
        <div className="chart-container" style={{ height: 220 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={defectTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: '#737373', fontSize: 12 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: '#737373', fontSize: 12 }} domain={[0, 'auto']} />
              <Tooltip content={<DefectTooltip />} />
              <Area
                type="monotone"
                dataKey="rate"
                stroke="#404040"
                strokeWidth={2}
                fill="#e5e5e5"
                fillOpacity={0.5}
                dot={{ r: 4, fill: '#262626', strokeWidth: 0 }}
                activeDot={{ r: 6, fill: '#171717', strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        {resultFilters.map(filter => (
          <button
            key={filter}
            className={`filter-chip ${activeFilter === filter ? 'active' : ''}`}
            onClick={() => setActiveFilter(filter)}
          >
            {filter}
          </button>
        ))}
      </div>

      {/* Inspections Table */}
      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Inspection ID</th>
              <th>Order</th>
              <th>Fabric</th>
              <th>Inspector</th>
              <th>Date</th>
              <th>Defects/100m</th>
              <th>Result</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(qc => (
              <tr key={qc.id}>
                <td className="table-cell-primary">{qc.id}</td>
                <td>{qc.order}</td>
                <td>{qc.fabric}</td>
                <td>{qc.inspector}</td>
                <td style={{ color: 'var(--color-gray-500)' }}>{qc.date}</td>
                <td>
                  <span style={{
                    fontWeight: 600,
                    color: qc.defectsPerHundred > 5 ? 'var(--color-error)' : 'var(--color-gray-900)',
                  }}>
                    {qc.defectsPerHundred}
                  </span>
                </td>
                <td>
                  <span className={`badge ${qc.result === 'Fail' ? 'badge-error' : 'badge-neutral'}`}>
                    {qc.result === 'Fail' && <AlertCircle size={11} />}
                    {qc.result}
                  </span>
                </td>
                <td style={{ maxWidth: 200, fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-500)' }}>
                  {qc.notes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
