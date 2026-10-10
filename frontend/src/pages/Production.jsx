import { useState, useMemo } from 'react';
import {
  Play,
  Pause,
  StopCircle,
  AlertCircle,
  Clock,
  User,
  Gauge,
  Plus,
  Download,
  Search,
  CheckCircle2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { exportToCSV } from '../utils/csvExport';

const initialWorkOrders = [
  {
    id: 'WO-1001',
    order: 'ORD-2410-001',
    machine: 'Rapier Loom A-12',
    fabric: 'Cotton Twill 2/1',
    targetQty: '12,000 m',
    completedQty: '7,800 m',
    speed: '42 m/hr',
    status: 'Running',
    shift: 'Day Shift (08:00 - 16:00)',
    operator: 'Rajesh Kumar',
  },
  {
    id: 'WO-1002',
    order: 'ORD-2410-002',
    machine: 'Air Jet Loom B-04',
    fabric: 'Polyester Satin',
    targetQty: '8,500 m',
    completedQty: '3,570 m',
    speed: '38 m/hr',
    status: 'Running',
    shift: 'Day Shift (08:00 - 16:00)',
    operator: 'Suresh Maurya',
  },
  {
    id: 'WO-1003',
    order: 'ORD-2410-005',
    machine: 'Rapier Loom A-08',
    fabric: 'Viscose Crepe',
    targetQty: '15,000 m',
    completedQty: '4,200 m',
    speed: '35 m/hr',
    status: 'Running',
    shift: 'Day Shift (08:00 - 16:00)',
    operator: 'Amit Patel',
  },
  {
    id: 'WO-1004',
    order: 'ORD-2410-007',
    machine: 'Dobby Loom C-02',
    fabric: 'Cotton Dobby',
    targetQty: '9,800 m',
    completedQty: '5,390 m',
    speed: '40 m/hr',
    status: 'Running',
    shift: 'Night Shift (20:00 - 04:00)',
    operator: 'Vikram Singh',
  },
  {
    id: 'WO-1005',
    order: 'ORD-2410-010',
    machine: 'Air Jet Loom B-07',
    fabric: 'Wool Blend Suiting',
    targetQty: '3,200 m',
    completedQty: '2,304 m',
    speed: '28 m/hr',
    status: 'Running',
    shift: 'Day Shift (08:00 - 16:00)',
    operator: 'Manoj Tiwari',
  },
  {
    id: 'WO-1006',
    order: 'ORD-2410-004',
    machine: 'Rapier Loom A-03',
    fabric: 'Bamboo Blend Jersey',
    targetQty: '6,200 m',
    completedQty: '5,704 m',
    speed: '0 m/hr',
    status: 'Completed',
    shift: '—',
    operator: 'Deepak Rao',
  },
  {
    id: 'WO-1007',
    order: 'ORD-2410-009',
    machine: 'Dobby Loom C-05',
    fabric: 'Polyester Twill',
    targetQty: '7,600 m',
    completedQty: '6,688 m',
    speed: '0 m/hr',
    status: 'Halted — QC / Tension Defect',
    shift: '—',
    operator: 'Sanjay Gupta',
  },
];

const statusFilters = ['All', 'Running', 'Completed', 'Halted'];

export default function Production() {
  const { toast } = useApp();
  const [runs, setRuns] = useState(initialWorkOrders);
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = useMemo(() => {
    return runs.filter((run) => {
      const matchesFilter =
        activeFilter === 'All' ||
        (activeFilter === 'Running' && run.status === 'Running') ||
        (activeFilter === 'Completed' && run.status === 'Completed') ||
        (activeFilter === 'Halted' && run.status.startsWith('Halted'));

      const matchesSearch =
        !searchTerm ||
        run.id.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        run.order.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        run.machine.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        run.fabric.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        run.operator.toLowerCase().includes(searchTerm.toLowerCase().trim());

      return matchesFilter && matchesSearch;
    });
  }, [runs, activeFilter, searchTerm]);

  const toggleRunStatus = (id) => {
    setRuns((prev) =>
      prev.map((r) => {
        if (r.id === id) {
          const isRunning = r.status === 'Running';
          const nextStatus = isRunning ? 'Paused — Shift Handover' : 'Running';
          toast.info(
            `Work order ${id} is now ${nextStatus}.`,
            isRunning ? 'Run Paused' : 'Run Resumed'
          );
          return {
            ...r,
            status: nextStatus,
            speed: isRunning ? '0 m/hr' : '40 m/hr',
          };
        }
        return r;
      })
    );
  };

  const handleExportRuns = () => {
    const success = exportToCSV('production_work_orders', runs, [
      { key: 'id', label: 'Work Order' },
      { key: 'order', label: 'Manufacturing Order' },
      { key: 'machine', label: 'Work Center Loom' },
      { key: 'fabric', label: 'Fabric Quality' },
      { key: 'targetQty', label: 'Target Output' },
      { key: 'completedQty', label: 'Woven Output' },
      { key: 'speed', label: 'Speed' },
      { key: 'shift', label: 'Assigned Shift' },
      { key: 'operator', label: 'Master Operator' },
      { key: 'status', label: 'Execution Status' },
    ]);
    if (success) {
      toast.success('Work orders exported to CSV file successfully.', 'Export Complete');
    }
  };

  const runningCount = runs.filter((r) => r.status === 'Running').length;
  const haltedCount = runs.filter((r) => r.status.startsWith('Halted')).length;

  return (
    <div className="erp-page-container">
      <div className="erp-page-header">
        <div className="erp-page-header-text">
          <h1 className="erp-page-title">Work Orders & Batch Execution</h1>
          <p className="erp-page-subtitle">
            Active loom runs, batch speeds, shift assignments, and floor progress monitoring
          </p>
        </div>
        <div className="erp-page-actions">
          <button type="button" className="erp-btn-outline" onClick={handleExportRuns} title="Export work orders to CSV">
            <Download size={16} />
            <span>Export Work Orders</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="erp-tall-kpi-grid" style={{ marginBottom: 20 }}>
        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Active Work Orders</span>
            <Play size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">{runningCount}</div>
          <div className="tall-kpi-subtext">Active shedding lines</div>
        </div>

        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Fleet Run Rate</span>
            <Gauge size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">36.6 m/h</div>
          <div className="tall-kpi-change">+4.2% vs target</div>
        </div>

        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Completed Batches</span>
            <StopCircle size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">
            {runs.filter((r) => r.status === 'Completed').length}
          </div>
          <div className="tall-kpi-subtext">Transferred to QC</div>
        </div>

        <div className={`erp-tall-kpi-card ${haltedCount > 0 ? 'error' : ''}`}>
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Halted / Stoppages</span>
            <AlertCircle size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value" style={haltedCount > 0 ? { color: 'var(--color-error)' } : {}}>
            {haltedCount}
          </div>
          <div className="tall-kpi-subtext" style={haltedCount > 0 ? { color: 'var(--color-error)' } : {}}>
            {haltedCount > 0 ? 'Requires Floor Manager attention' : 'Clean floor cycle'}
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="erp-filter-bar">
        <div className="filter-chips-row">
          {statusFilters.map((filter) => (
            <button
              key={filter}
              type="button"
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
            placeholder="Search work orders, loom, fabric, operator..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => setSearchTerm('')}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Production Cards Grid */}
      <div className="erp-charts-grid">
        {filtered.map((run) => {
          const isError = run.status.startsWith('Halted');
          const isCompleted = run.status === 'Completed';
          const isRunning = run.status === 'Running';
          const targetNum = parseInt(run.targetQty.replace(/,/g, ''), 10);
          const completedNum = parseInt(run.completedQty.replace(/,/g, ''), 10);
          const progress = Math.round((completedNum / targetNum) * 100);

          return (
            <div
              key={run.id}
              className={`erp-card ${isError ? 'error-card' : ''}`}
              style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
            >
              <div>
                <div className="machine-card-header">
                  <div>
                    <span className="machine-id-badge font-mono">{run.id}</span>
                    <h3 className="machine-title">{run.fabric}</h3>
                    <div className="text-xs text-secondary">
                      Order: {run.order} • {run.machine}
                    </div>
                  </div>
                  <span
                    className={`erp-status-badge ${
                      isError ? 'error' : isRunning ? 'active' : 'outline'
                    }`}
                  >
                    {run.status}
                  </span>
                </div>

                {/* Progress bar */}
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span className="text-xs text-secondary">Woven Meters Progress</span>
                    <strong className="text-xs">{progress}%</strong>
                  </div>
                  <div className="erp-progress-bar">
                    <div
                      className={`erp-progress-fill ${isError ? 'error' : ''}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                    <span className="text-xs text-secondary">{run.completedQty} woven</span>
                    <span className="text-xs text-secondary">Target: {run.targetQty}</span>
                  </div>
                </div>

                {/* Details */}
                <div className="machine-telemetry-grid" style={{ marginTop: 14 }}>
                  <div className="telemetry-item">
                    <span className="telemetry-label">Running Speed</span>
                    <strong className="telemetry-val">{run.speed}</strong>
                  </div>
                  <div className="telemetry-item">
                    <span className="telemetry-label">Assigned Shift</span>
                    <strong className="telemetry-val">{run.shift}</strong>
                  </div>
                  <div className="telemetry-item" style={{ gridColumn: 'span 2' }}>
                    <span className="telemetry-label">Master Operator</span>
                    <strong className="telemetry-val">{run.operator}</strong>
                  </div>
                </div>
              </div>

              {!isCompleted && !isError && (
                <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--color-gray-200)' }}>
                  <button
                    type="button"
                    className="erp-btn-sm erp-btn-outline"
                    onClick={() => toggleRunStatus(run.id)}
                  >
                    {isRunning ? <Pause size={13} /> : <Play size={13} />}
                    <span>{isRunning ? 'Pause Run' : 'Resume Run'}</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
