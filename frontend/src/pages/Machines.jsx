import { useState } from 'react';
import {
  Cog,
  AlertCircle,
  Wrench,
  Power,
  Play,
  RotateCcw,
  Sparkles,
  Search,
  CheckCircle2,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';

const statusFilters = ['All', 'Running', 'Idle', 'Halted / Error'];

export default function Machines() {
  const { machines, reportMachineProblem, resolveMachineProblem } = useApp();
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [reportingMachine, setReportingMachine] = useState(null);

  const [problemForm, setProblemForm] = useState({
    type: 'Mechanical / Yarn Tension',
    severity: 'Critical',
    description: '',
    pauseProduction: true,
  });

  const filtered = machines.filter((m) => {
    const matchesSearch =
      m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.type.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter =
      activeFilter === 'All' ||
      (activeFilter === 'Running' && m.status === 'Running') ||
      (activeFilter === 'Idle' && m.status === 'Idle') ||
      (activeFilter === 'Halted / Error' && m.error);
    return matchesSearch && matchesFilter;
  });

  const runningCount = machines.filter((m) => m.status === 'Running').length;
  const idleCount = machines.filter((m) => m.status === 'Idle').length;
  const errorCount = machines.filter((m) => m.error).length;

  const handleProblemSubmit = (e) => {
    e.preventDefault();
    if (reportingMachine) {
      reportMachineProblem(reportingMachine.id, problemForm);
      setReportingMachine(null);
      setProblemForm({
        type: 'Mechanical / Yarn Tension',
        severity: 'Critical',
        description: '',
        pauseProduction: true,
      });
    }
  };

  return (
    <div className="erp-page-container">
      <div className="erp-page-header">
        <div className="erp-page-header-text">
          <h1 className="erp-page-title">Work Centers — Loom Shed & Preparation Fleet</h1>
          <p className="erp-page-subtitle">
            Section 8: Machine telemetry, status state transitions, and Floor Manager problem escalation
          </p>
        </div>
      </div>

      {/* Critical Alert Banner if error machines exist */}
      {errorCount > 0 && (
        <div className="erp-alert-box">
          <div className="erp-alert-icon">
            <AlertCircle size={20} />
          </div>
          <div className="erp-alert-content">
            <div className="erp-alert-title">
              Critical Work Center Alert: {errorCount} Loom{errorCount !== 1 ? 's' : ''} Halted
            </div>
            <div className="erp-alert-desc">
              Unscheduled stoppage detected on production floor. Action needed to mitigate order delay risks.
            </div>
          </div>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="erp-tall-kpi-grid" style={{ marginBottom: 20 }}>
        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Total Fleet Units</span>
            <Cog size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">{machines.length}</div>
          <div className="tall-kpi-subtext">Rapier, Air Jet & Dobby Sheds</div>
        </div>

        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Actively Weaving</span>
            <Power size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">{runningCount}</div>
          <div className="tall-kpi-subtext">{((runningCount / machines.length) * 100).toFixed(0)}% Fleet In-Service</div>
        </div>

        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Idle / Standby</span>
            <Play size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">{idleCount}</div>
          <div className="tall-kpi-subtext">Available for immediate order allocation</div>
        </div>

        <div className={`erp-tall-kpi-card ${errorCount > 0 ? 'error' : ''}`}>
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Halted / Maintenance</span>
            <AlertCircle size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value" style={errorCount > 0 ? { color: 'var(--color-error)' } : {}}>
            {errorCount}
          </div>
          <div className="tall-kpi-subtext" style={errorCount > 0 ? { color: 'var(--color-error)' } : {}}>
            {errorCount > 0 ? 'Immediate repair dispatch required' : 'All lines functional'}
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="erp-filter-bar">
        <div className="filter-chips-row">
          {statusFilters.map((filter) => (
            <button
              key={filter}
              className={`erp-filter-chip ${activeFilter === filter ? 'active' : ''}`}
              onClick={() => setActiveFilter(filter)}
            >
              {filter}
            </button>
          ))}
        </div>
        <div className="erp-search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search loom or machine ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Machines Cards Grid */}
      <div className="erp-machines-grid">
        {filtered.map((machine) => {
          const isError = machine.error;
          const isRunning = machine.status === 'Running';

          return (
            <div
              key={machine.id}
              className={`erp-card machine-card ${isError ? 'error-card' : ''}`}
            >
              <div className="machine-card-header">
                <div>
                  <span className="machine-id-badge">{machine.id}</span>
                  <h3 className="machine-title">{machine.name}</h3>
                </div>
                <span
                  className={`erp-status-badge ${
                    isError ? 'error' : isRunning ? 'active' : 'outline'
                  }`}
                >
                  {isError && <AlertCircle size={12} style={{ marginRight: 3 }} />}
                  {machine.status}
                </span>
              </div>

              {/* Machine Telemetry Grid */}
              <div className="machine-telemetry-grid">
                <div className="telemetry-item">
                  <span className="telemetry-label">Process Category</span>
                  <strong className="telemetry-val">{machine.type}</strong>
                </div>
                <div className="telemetry-item">
                  <span className="telemetry-label">Speed / Throughput</span>
                  <strong className="telemetry-val">{machine.speed}</strong>
                </div>
                <div className="telemetry-item">
                  <span className="telemetry-label">Motor RPM</span>
                  <strong className="telemetry-val">{machine.rpm} RPM</strong>
                </div>
                <div className="telemetry-item">
                  <span className="telemetry-label">Uptime Rating</span>
                  <strong className="telemetry-val">{machine.uptime}</strong>
                </div>
                <div className="telemetry-item" style={{ gridColumn: 'span 2' }}>
                  <span className="telemetry-label">Current Job</span>
                  <strong className="telemetry-val">
                    {machine.currentOrder !== '—' ? machine.currentOrder : 'No active run assigned'}
                  </strong>
                </div>
              </div>

              {/* Problem details banner if halted */}
              {machine.problem && (
                <div className="machine-problem-banner">
                  <div className="problem-banner-title">
                    <AlertCircle size={14} style={{ color: 'var(--color-error)' }} />
                    <strong>{machine.problem.severity} Issue: {machine.problem.type}</strong>
                  </div>
                  <p className="problem-banner-desc">{machine.problem.description}</p>
                  <span className="text-xs text-secondary">
                    Reported by: {machine.problem.reportedBy} ({machine.problem.reportedAt})
                  </span>
                </div>
              )}

              {/* Actions Footer */}
              <div className="machine-card-footer">
                {isError ? (
                  <button
                    className="erp-btn-sm erp-btn-dark"
                    onClick={() => resolveMachineProblem(machine.id)}
                  >
                    <RotateCcw size={14} />
                    <span>Complete Maintenance & Resume</span>
                  </button>
                ) : (
                  <button
                    className="erp-btn-sm erp-btn-outline"
                    onClick={() => setReportingMachine(machine)}
                  >
                    <Wrench size={14} />
                    <span>Report Problem</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* MODAL: Report Machine Problem (Floor Manager Section 8) */}
      {reportingMachine && (
        <div className="erp-modal-overlay">
          <div className="erp-modal-box">
            <div className="modal-header">
              <div>
                <h3 className="modal-title">Report Work Center Issue</h3>
                <p className="modal-subtitle">
                  {reportingMachine.name} ({reportingMachine.id}) • Current Order: {reportingMachine.currentOrder}
                </p>
              </div>
              <button className="modal-close-btn" onClick={() => setReportingMachine(null)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleProblemSubmit}>
              <div className="modal-body">
                <div className="erp-form-grid">
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="erp-label">Problem Category</label>
                    <select
                      className="erp-select"
                      value={problemForm.type}
                      onChange={(e) => setProblemForm({ ...problemForm, type: e.target.value })}
                    >
                      <option>Mechanical / Yarn Tension</option>
                      <option>Electrical / Motor Fault</option>
                      <option>Weft Insertion Error</option>
                      <option>Warp Beam Jam / Snapping</option>
                      <option>Dobby / Jacquard Pattern Misalignment</option>
                      <option>Lubrication / Overheating</option>
                    </select>
                  </div>

                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="erp-label">Severity Level</label>
                    <select
                      className="erp-select"
                      value={problemForm.severity}
                      onChange={(e) => setProblemForm({ ...problemForm, severity: e.target.value })}
                    >
                      <option>Low — Cosmetic or slight vibration</option>
                      <option>Medium — Requires shift maintenance inspection</option>
                      <option>Critical — Recurrent breakage, shutdown mandated</option>
                    </select>
                  </div>

                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="erp-label">Incident Description & Observations</label>
                    <textarea
                      className="erp-input"
                      rows={3}
                      placeholder="Describe symptoms, broken components, or warp line defects..."
                      value={problemForm.description}
                      onChange={(e) => setProblemForm({ ...problemForm, description: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={problemForm.pauseProduction}
                        onChange={(e) =>
                          setProblemForm({ ...problemForm, pauseProduction: e.target.checked })
                        }
                      />
                      <span>Immediately Halt Loom Shed Production Run</span>
                    </label>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="erp-btn-outline"
                  onClick={() => setReportingMachine(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="erp-btn-primary">
                  Submit Incident & Notify Floor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
