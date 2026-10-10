import { useState } from 'react';
import { Cog, AlertCircle, Wrench, Activity, Calendar, Power, Search } from 'lucide-react';
import { machines } from '../data/mockData';

const statusFilters = ['All', 'Running', 'Idle', 'Error'];

export default function Machines() {
  const [activeFilter, setActiveFilter] = useState('All');

  const filtered = machines.filter(m => {
    if (activeFilter === 'All') return true;
    if (activeFilter === 'Running') return m.status === 'Running';
    if (activeFilter === 'Idle') return m.status === 'Idle';
    if (activeFilter === 'Error') return m.error;
    return true;
  });

  const runningCount = machines.filter(m => m.status === 'Running').length;
  const idleCount = machines.filter(m => m.status === 'Idle').length;
  const errorCount = machines.filter(m => m.error).length;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-info">
          <h1>Machines</h1>
          <p>Machine fleet status, maintenance, and performance</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary">
            <Calendar size={16} />
            Maintenance Schedule
          </button>
          <button className="btn btn-primary">
            <Wrench size={16} />
            Log Maintenance
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {errorCount > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--color-error-light)',
          border: '1px solid var(--color-error-border)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 'var(--space-4)',
          fontSize: 'var(--font-size-base)',
        }}>
          <AlertCircle size={16} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
          <span style={{ color: 'var(--color-error-dark)' }}>
            <strong>{errorCount} machine{errorCount !== 1 ? 's' : ''}</strong> reporting errors. Immediate attention required.
          </span>
        </div>
      )}

      {/* Summary */}
      <div className="grid-4" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="metric-card">
          <div className="metric-card-label">
            <Cog size={16} />
            Total Machines
          </div>
          <div className="metric-card-value">{machines.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-card-label">
            <Power size={16} />
            Running
          </div>
          <div className="metric-card-value">{runningCount}</div>
        </div>
        <div className="metric-card">
          <div className="metric-card-label">Idle</div>
          <div className="metric-card-value">{idleCount}</div>
        </div>
        <div className={`metric-card ${errorCount > 0 ? 'error' : ''}`}>
          <div className="metric-card-label">
            <AlertCircle size={16} />
            Errors
          </div>
          <div className="metric-card-value">{errorCount}</div>
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

      {/* Machine Cards */}
      <div className="grid-2">
        {filtered.map(machine => {
          const isError = machine.error;
          const isRunning = machine.status === 'Running';
          const isIdle = machine.status === 'Idle';

          return (
            <div
              key={machine.id}
              className="card"
              style={isError ? {
                borderColor: 'var(--color-error-border)',
                background: 'var(--color-error-light)',
              } : {}}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <div style={{
                    width: 40,
                    height: 40,
                    borderRadius: 'var(--radius-md)',
                    background: isError ? 'var(--color-error-border)' : 'var(--color-gray-150)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <Cog size={20} style={{ color: isError ? 'var(--color-error)' : 'var(--color-gray-600)' }} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--color-black)' }}>{machine.name}</div>
                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-500)' }}>{machine.id} · {machine.type}</div>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className={`status-dot ${isError ? 'status-dot-error' : isRunning ? 'status-dot-active' : 'status-dot-idle'}`} />
                  <span className={`badge ${isError ? 'badge-error' : isRunning ? 'badge-dark' : 'badge-neutral'}`}>
                    {isError && <AlertCircle size={11} />}
                    {machine.status}
                  </span>
                </div>
              </div>

              {/* Machine Details */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)', fontSize: 'var(--font-size-sm)' }}>
                <div>
                  <div style={{ color: 'var(--color-gray-400)', marginBottom: 2 }}>RPM</div>
                  <div style={{ fontWeight: 600, color: 'var(--color-gray-900)' }}>{machine.rpm || '—'}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--color-gray-400)', marginBottom: 2 }}>Efficiency</div>
                  <div style={{ fontWeight: 600, color: 'var(--color-gray-900)' }}>{machine.efficiency}</div>
                </div>
                <div>
                  <div style={{ color: 'var(--color-gray-400)', marginBottom: 2 }}>Uptime</div>
                  <div style={{
                    fontWeight: 600,
                    color: isError ? 'var(--color-error)' : 'var(--color-gray-900)',
                  }}>
                    {machine.uptime}
                  </div>
                </div>
              </div>

              <hr className="divider" />

              {/* Maintenance */}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-sm)' }}>
                <div>
                  <span style={{ color: 'var(--color-gray-400)' }}>Last maintenance: </span>
                  <span style={{ color: 'var(--color-gray-700)' }}>{machine.lastMaintenance}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--color-gray-400)' }}>Next: </span>
                  <span style={{
                    color: new Date(machine.nextMaintenance) <= new Date() ? 'var(--color-error)' : 'var(--color-gray-700)',
                    fontWeight: new Date(machine.nextMaintenance) <= new Date() ? 600 : 400,
                  }}>
                    {machine.nextMaintenance}
                    {new Date(machine.nextMaintenance) <= new Date() && ' — Overdue'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
