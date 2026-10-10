import { useState } from 'react';
import { Play, Pause, StopCircle, AlertCircle, Clock, User, Gauge } from 'lucide-react';
import { productionRuns } from '../data/mockData';

const statusFilters = ['All', 'Running', 'Completed', 'Halted'];

export default function Production() {
  const [activeFilter, setActiveFilter] = useState('All');

  const filtered = productionRuns.filter(run => {
    if (activeFilter === 'All') return true;
    if (activeFilter === 'Running') return run.status === 'Running';
    if (activeFilter === 'Completed') return run.status === 'Completed';
    if (activeFilter === 'Halted') return run.status.startsWith('Halted');
    return true;
  });

  const runningCount = productionRuns.filter(r => r.status === 'Running').length;
  const haltedCount = productionRuns.filter(r => r.status.startsWith('Halted')).length;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-info">
          <h1>Production</h1>
          <p>Monitor active production runs across all looms</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary">
            <Play size={16} />
            Start New Run
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid-3" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="metric-card">
          <div className="metric-card-label">
            <Play size={16} />
            Running
          </div>
          <div className="metric-card-value">{runningCount}</div>
          <div className="metric-card-change">Active production lines</div>
        </div>
        <div className="metric-card">
          <div className="metric-card-label">
            <StopCircle size={16} />
            Completed
          </div>
          <div className="metric-card-value">{productionRuns.filter(r => r.status === 'Completed').length}</div>
          <div className="metric-card-change">Awaiting QC or dispatch</div>
        </div>
        <div className={`metric-card ${haltedCount > 0 ? 'error' : ''}`}>
          <div className="metric-card-label">
            <AlertCircle size={16} />
            Halted
          </div>
          <div className="metric-card-value">{haltedCount}</div>
          <div className="metric-card-change" style={haltedCount > 0 ? { color: 'var(--color-error)' } : {}}>
            {haltedCount > 0 ? 'Requires attention' : 'No halted runs'}
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="filter-bar">
        {statusFilters.map(filter => (
          <button
            key={filter}
            className={`filter-chip ${activeFilter === filter ? 'active' : ''}`}
            onClick={() => setActiveFilter(filter)}
          >
            {filter}
          </button>
        ))}
      </div>

      {/* Production Cards */}
      <div className="grid-2">
        {filtered.map(run => {
          const isError = run.status.startsWith('Halted');
          const isCompleted = run.status === 'Completed';
          const targetNum = parseInt(run.targetQty.replace(/,/g, ''));
          const completedNum = parseInt(run.completedQty.replace(/,/g, ''));
          const progress = Math.round((completedNum / targetNum) * 100);

          return (
            <div
              key={run.id}
              className="card"
              style={isError ? {
                borderColor: 'var(--color-error-border)',
                background: 'var(--color-error-light)',
              } : {}}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{ fontWeight: 600, fontSize: 'var(--font-size-md)', color: 'var(--color-black)' }}>{run.id}</span>
                    <span className={`badge ${isError ? 'badge-error' : isCompleted ? 'badge-neutral' : 'badge-dark'}`}>
                      {isError && <AlertCircle size={11} />}
                      {run.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-500)', marginTop: 2 }}>
                    Order {run.order} — {run.fabric}
                  </div>
                </div>
                {!isCompleted && !isError && (
                  <button className="btn btn-ghost btn-sm">
                    <Pause size={14} />
                  </button>
                )}
              </div>

              {/* Progress */}
              <div style={{ marginBottom: 'var(--space-3)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 'var(--font-size-sm)' }}>
                  <span style={{ color: 'var(--color-gray-600)' }}>{run.completedQty} / {run.targetQty}</span>
                  <span style={{ fontWeight: 600, color: isError ? 'var(--color-error)' : 'var(--color-gray-900)' }}>{progress}%</span>
                </div>
                <div className="progress-bar" style={{ height: 8 }}>
                  <div
                    className={`progress-bar-fill ${isError ? 'error' : ''}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {/* Details Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)', fontSize: 'var(--font-size-sm)' }}>
                <div>
                  <div style={{ color: 'var(--color-gray-400)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Gauge size={12} /> Machine
                  </div>
                  <div style={{ fontWeight: 500, color: 'var(--color-gray-800)' }}>{run.machine}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--color-gray-400)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Clock size={12} /> Speed
                  </div>
                  <div style={{ fontWeight: 500, color: 'var(--color-gray-800)' }}>{run.speed}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--color-gray-400)', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <User size={12} /> Operator
                  </div>
                  <div style={{ fontWeight: 500, color: 'var(--color-gray-800)' }}>{run.operator}</div>
                </div>
              </div>

              {/* Shift info */}
              <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--font-size-xs)', color: 'var(--color-gray-400)' }}>
                Shift: {run.shift}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
