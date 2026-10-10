import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  RotateCcw,
  AlertTriangle,
  Activity,
  CheckCircle2,
  Play,
  Wrench,
  AlertOctagon,
  Clock,
  ShieldAlert,
  Box,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { factorySections, factoryUnits } from '../data/factoryFloorData';
import FactorySection from '../components/FactorySection';
import FactoryUnitModal from '../components/FactoryUnitModal';

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'All Statuses' },
  { value: 'RUNNING', label: 'Running' },
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'IDLE', label: 'Idle' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'DOWN', label: 'Down (Critical)' },
];

export default function Machines() {
  const navigate = useNavigate();
  const { currentRole } = useApp();

  // Role-Based Access Control: Only ADMIN_OWNER and FLOOR_MANAGER are authorized
  const isAuthorized =
    currentRole && (currentRole.id === 'ADMIN_OWNER' || currentRole.id === 'FLOOR_MANAGER');

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSection, setSelectedSection] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');

  // Selected Unit for Detail Modal
  const [selectedUnit, setSelectedUnit] = useState(null);

  // Local demo problem reports list
  const [reportedProblems, setReportedProblems] = useState([
    {
      id: 'REP-9012',
      unitId: 'WV-16',
      unitName: 'Dobby Loom C-05',
      section: 'Weaving Section',
      category: 'Mechanical',
      severity: 'Critical',
      description: 'CRITICAL BREAKDOWN: Warp yarn tension break across harness shaft #4. Line halted.',
      timestamp: '09:15 AM',
      date: '2026-10-10',
      isDemoState: true,
    },
    {
      id: 'REP-9013',
      unitId: 'SP-10',
      unitName: 'Ring Spinning Frame RS-03',
      section: 'Spinning Section',
      category: 'Electrical',
      severity: 'Critical',
      description: 'Main spindle drive flat belt snapped on Section 4. Maintenance crew installing spare.',
      timestamp: '08:45 AM',
      date: '2026-10-10',
      isDemoState: true,
    },
    {
      id: 'REP-9014',
      unitId: 'RM-06',
      unitName: 'Bamboo Viscose Staging B2',
      section: 'Raw Material Store',
      category: 'Mechanical',
      severity: 'Critical',
      description: 'Overhead pallet crane hoist cable jam. Automatic retrieval halted; repair crew dispatched.',
      timestamp: '07:30 AM',
      date: '2026-10-10',
      isDemoState: true,
    },
  ]);

  const handleReportProblem = (newReport) => {
    setReportedProblems((prev) => [newReport, ...prev]);
  };

  // Dynamic KPI counts derived from actual dataset
  const kpis = useMemo(() => {
    const total = factoryUnits.length;
    const running = factoryUnits.filter((u) => u.status === 'RUNNING').length;
    const available = factoryUnits.filter((u) => u.status === 'AVAILABLE').length;
    const idle = factoryUnits.filter((u) => u.status === 'IDLE').length;
    const paused = factoryUnits.filter((u) => u.status === 'PAUSED').length;
    const maintenance = factoryUnits.filter((u) => u.status === 'MAINTENANCE').length;
    const down = factoryUnits.filter((u) => u.status === 'DOWN').length;

    return { total, running, available, idle, paused, maintenance, down };
  }, []);

  // Filtered dataset
  const filteredUnits = useMemo(() => {
    return factoryUnits.filter((unit) => {
      // Search term: ID, Name, Order, Type, Section
      const matchesSearch =
        searchTerm.trim() === '' ||
        unit.id.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        unit.name.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        (unit.currentOrder && unit.currentOrder.toLowerCase().includes(searchTerm.toLowerCase().trim())) ||
        (unit.type && unit.type.toLowerCase().includes(searchTerm.toLowerCase().trim())) ||
        unit.section.toLowerCase().includes(searchTerm.toLowerCase().trim());

      // Section filter
      const matchesSection = selectedSection === 'ALL' || unit.sectionId === selectedSection;

      // Status filter
      const matchesStatus = selectedStatus === 'ALL' || unit.status === selectedStatus;

      return matchesSearch && matchesSection && matchesStatus;
    });
  }, [searchTerm, selectedSection, selectedStatus]);

  // Dynamic Summary Table counts by section
  const summaryTableData = useMemo(() => {
    return factorySections.map((sec) => {
      const unitsInSec = factoryUnits.filter((u) => u.sectionId === sec.id);
      return {
        sectionId: sec.id,
        sectionName: sec.name,
        prefix: sec.prefix,
        count: unitsInSec.length,
        running: unitsInSec.filter((u) => u.status === 'RUNNING').length,
        available: unitsInSec.filter((u) => u.status === 'AVAILABLE').length,
        idle: unitsInSec.filter((u) => u.status === 'IDLE').length,
        paused: unitsInSec.filter((u) => u.status === 'PAUSED').length,
        maintenance: unitsInSec.filter((u) => u.status === 'MAINTENANCE').length,
        down: unitsInSec.filter((u) => u.status === 'DOWN').length,
      };
    });
  }, []);

  const clearFilters = () => {
    setSearchTerm('');
    setSelectedSection('ALL');
    setSelectedStatus('ALL');
  };

  const hasActiveFilters =
    searchTerm.trim() !== '' || selectedSection !== 'ALL' || selectedStatus !== 'ALL';

  // ========================================================
  // UNAUTHORIZED ACCESS STATE (RBAC Enforcement)
  // ========================================================
  if (!isAuthorized) {
    return (
      <div className="erp-page-container">
        <div className="factory-access-restricted-card">
          <div className="restricted-icon-box">
            <ShieldAlert size={36} className="text-muted" />
          </div>
          <h2 className="restricted-title">Access Restricted — Factory Floor Map</h2>
          <p className="restricted-desc">
            The interactive Factory Floor Map and equipment telemetry feed are restricted to{' '}
            <strong>Admin</strong> and <strong>Floor Manager</strong> roles.
          </p>
          <div className="restricted-role-info">
            <span className="text-xs text-muted">CURRENT LOGGED-IN IDENTITY:</span>
            <div className="restricted-role-pill">
              <strong>{currentRole?.name || 'Unknown User'}</strong>
              <span className="restricted-role-id">({currentRole?.id || 'NO_ROLE'})</span>
            </div>
            <p className="text-xs text-secondary" style={{ marginTop: 8 }}>
              To inspect this feature, use the role switcher located at the top-right of the header
              bar and select <strong>Admin</strong> or <strong>Floor Manager</strong>.
            </p>
          </div>
          <div className="restricted-actions">
            <button
              type="button"
              className="erp-btn-secondary"
              onClick={() => navigate('/dashboard')}
            >
              Return to Executive Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ========================================================
  // AUTHORIZED ACCESS: FACTORY FLOOR MAP VIEW
  // ========================================================
  return (
    <div className="erp-page-container factory-page-wrapper">
      {/* 4. Page Header */}
      <div className="factory-page-header">
        <div className="factory-header-left">
          <div className="factory-title-row">
            <h1 className="factory-main-title">Factory Floor Map</h1>
            <span className="factory-demo-badge">DEMO DATA</span>
            <span className="factory-live-pulse-badge">
              <span className="pulse-dot" />
              <span>Telemetry Active</span>
            </span>
          </div>
          <p className="factory-main-subtitle">
            Live view of factory sections, machines, and storage locations.
          </p>
        </div>

        <div className="factory-header-right">
          <div className="factory-last-updated-box">
            <Clock size={14} className="text-muted" />
            <span>Updated: Just now (Simulated Feed)</span>
          </div>
        </div>
      </div>

      {/* 5. Summary KPI Cards (Monochrome + Red for DOWN) */}
      <div className="factory-kpi-grid">
        <div className="factory-kpi-card" title="Total factory floor units across all 8 conceptual sections">
          <div className="factory-kpi-card-header">
            <span className="factory-kpi-label">Total Units</span>
            <Box size={16} className="text-muted" />
          </div>
          <div className="factory-kpi-value">{kpis.total}</div>
          <div className="factory-kpi-meta">74 Tracked Bays & Machines</div>
        </div>

        <div className="factory-kpi-card" title="Actively spinning, weaving, or processing orders">
          <div className="factory-kpi-card-header">
            <span className="factory-kpi-label">Running</span>
            <Activity size={16} className="text-muted" />
          </div>
          <div className="factory-kpi-value">{kpis.running}</div>
          <div className="factory-kpi-meta">{((kpis.running / kpis.total) * 100).toFixed(0)}% Fleet In-Service</div>
        </div>

        <div className="factory-kpi-card" title="Ready for immediate batch assignment or staging">
          <div className="factory-kpi-card-header">
            <span className="factory-kpi-label">Available</span>
            <CheckCircle2 size={16} className="text-muted" />
          </div>
          <div className="factory-kpi-value">{kpis.available}</div>
          <div className="factory-kpi-meta">Clean & Ready for Work Orders</div>
        </div>

        <div className="factory-kpi-card" title="Standby between production shifts">
          <div className="factory-kpi-card-header">
            <span className="factory-kpi-label">Idle</span>
            <Play size={16} className="text-muted" />
          </div>
          <div className="factory-kpi-value">{kpis.idle}</div>
          <div className="factory-kpi-meta">Awaiting Material or Beam</div>
        </div>

        <div className="factory-kpi-card" title="Under scheduled preventive servicing">
          <div className="factory-kpi-card-header">
            <span className="factory-kpi-label">Maintenance</span>
            <Wrench size={16} className="text-muted" />
          </div>
          <div className="factory-kpi-value">{kpis.maintenance}</div>
          <div className="factory-kpi-meta">Planned Lubrication & Overhaul</div>
        </div>

        <div className="factory-kpi-card kpi-card-down" title="Unscheduled stoppages & breakdown outages">
          <div className="factory-kpi-card-header">
            <span className="factory-kpi-label text-red">Down</span>
            <AlertOctagon size={16} className="text-red" />
          </div>
          <div className="factory-kpi-value text-red">{kpis.down}</div>
          <div className="factory-kpi-meta text-red">Critical Halt • Ticket Dispatched</div>
        </div>
      </div>

      {/* 6. Search and Filter Bar */}
      <div className="factory-filter-bar">
        <div className="factory-search-wrap">
          <Search size={16} className="factory-search-icon" />
          <input
            type="text"
            className="factory-search-input"
            placeholder="Search by unit ID (e.g. WV-03), name, order (ORD-...), or section..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button
              type="button"
              className="factory-search-clear-btn"
              onClick={() => setSearchTerm('')}
              title="Clear search input"
            >
              ×
            </button>
          )}
        </div>

        <div className="factory-filter-controls">
          <div className="factory-select-wrap">
            <label htmlFor="filter-section-select" className="factory-filter-label">
              Section:
            </label>
            <select
              id="filter-section-select"
              className="factory-filter-select"
              value={selectedSection}
              onChange={(e) => setSelectedSection(e.target.value)}
            >
              <option value="ALL">All Sections (8)</option>
              {factorySections.map((sec) => (
                <option key={sec.id} value={sec.id}>
                  {sec.name} ({sec.prefix})
                </option>
              ))}
            </select>
          </div>

          <div className="factory-select-wrap">
            <label htmlFor="filter-status-select" className="factory-filter-label">
              Status:
            </label>
            <select
              id="filter-status-select"
              className="factory-filter-select"
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              className="factory-clear-filters-btn"
              onClick={clearFilters}
              title="Reset all search and status filters"
            >
              <RotateCcw size={13} />
              <span>Clear Filters</span>
            </button>
          )}

          <div className="factory-filtered-count-badge">
            <span>
              Showing <strong>{filteredUnits.length}</strong> of {factoryUnits.length} Units
            </span>
          </div>
        </div>
      </div>

      {/* 7. Factory Floor Map Section Grid */}
      <main className="factory-map-main-area">
        {filteredUnits.length === 0 ? (
          <div className="factory-global-empty-state">
            <AlertTriangle size={32} className="text-muted" style={{ marginBottom: 12 }} />
            <h3>No Factory Units Match Your Criteria</h3>
            <p className="text-muted text-sm">
              No equipment or bays found matching &ldquo;{searchTerm}&rdquo; with the selected filters.
            </p>
            <button
              type="button"
              className="factory-btn-primary"
              style={{ marginTop: 14 }}
              onClick={clearFilters}
            >
              Reset Filters & Show All 74 Units
            </button>
          </div>
        ) : (
          <div className="factory-sections-grid">
            {factorySections.map((section) => {
              // Units in this section matching search/filters
              const sectionFilteredUnits = filteredUnits.filter((u) => u.sectionId === section.id);
              // All units in this section (for totals/availability ratio)
              const sectionAllUnits = factoryUnits.filter((u) => u.sectionId === section.id);

              // If a section filter is active and this is not the selected section, skip
              if (selectedSection !== 'ALL' && selectedSection !== section.id) {
                return null;
              }

              return (
                <FactorySection
                  key={section.id}
                  section={section}
                  units={sectionFilteredUnits}
                  allSectionUnits={sectionAllUnits}
                  selectedUnit={selectedUnit}
                  onSelectUnit={setSelectedUnit}
                />
              );
            })}
          </div>
        )}
      </main>

      {/* 12. Demo Data Summary Table */}
      <section className="factory-summary-table-section" aria-labelledby="summary-table-title">
        <div className="summary-table-header">
          <div>
            <h2 id="summary-table-title" className="summary-table-title">
              Factory Unit Distribution & Status Summary
            </h2>
            <p className="summary-table-subtitle">
              Mathematical cross-tabulation across all 8 conceptual textile plant departments.
            </p>
          </div>
          <span className="summary-demo-flag">DEMO AUDIT DATA</span>
        </div>

        <div className="factory-table-container">
          <table className="factory-erp-table">
            <thead>
              <tr>
                <th scope="col" style={{ width: '22%' }}>Section</th>
                <th scope="col" style={{ width: '10%' }}>Prefix</th>
                <th scope="col" style={{ width: '10%' }} className="text-right">Total</th>
                <th scope="col" style={{ width: '10%' }} className="text-right">Running</th>
                <th scope="col" style={{ width: '10%' }} className="text-right">Available</th>
                <th scope="col" style={{ width: '10%' }} className="text-right">Idle</th>
                <th scope="col" style={{ width: '10%' }} className="text-right">Paused</th>
                <th scope="col" style={{ width: '12%' }} className="text-right">Maintenance</th>
                <th scope="col" style={{ width: '10%' }} className="text-right text-red">Down</th>
              </tr>
            </thead>
            <tbody>
              {summaryTableData.map((row) => (
                <tr key={row.sectionId}>
                  <td className="font-semibold">{row.sectionName}</td>
                  <td>
                    <span className="table-prefix-pill">{row.prefix}</span>
                  </td>
                  <td className="text-right font-mono">{row.count}</td>
                  <td className="text-right font-mono">{row.running}</td>
                  <td className="text-right font-mono">{row.available}</td>
                  <td className="text-right font-mono">{row.idle}</td>
                  <td className="text-right font-mono">{row.paused}</td>
                  <td className="text-right font-mono">{row.maintenance}</td>
                  <td className={`text-right font-mono ${row.down > 0 ? 'text-red font-bold' : ''}`}>
                    {row.down}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="table-total-row">
                <td className="font-bold">Total Factory Fleet</td>
                <td className="font-mono text-xs text-muted">All 8 Sectors</td>
                <td className="text-right font-bold font-mono">{kpis.total}</td>
                <td className="text-right font-bold font-mono">{kpis.running}</td>
                <td className="text-right font-bold font-mono">{kpis.available}</td>
                <td className="text-right font-bold font-mono">{kpis.idle}</td>
                <td className="text-right font-bold font-mono">{kpis.paused}</td>
                <td className="text-right font-bold font-mono">{kpis.maintenance}</td>
                <td className={`text-right font-bold font-mono ${kpis.down > 0 ? 'text-red' : ''}`}>
                  {kpis.down}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="summary-table-note">
          <span>
            * Note: Paused units (4) represent temporary shift handovers or yarn beam re-creeling stops, accounted for explicitly in totals (40 Running + 13 Available + 9 Idle + 4 Paused + 5 Maintenance + 3 Down = 74 Total).
          </span>
        </div>
      </section>

      {/* 10. Machine Details Modal (Keyboard & Backdrop Safe) */}
      <FactoryUnitModal
        key={selectedUnit ? selectedUnit.id : 'none'}
        unit={selectedUnit}
        isOpen={Boolean(selectedUnit)}
        onClose={() => setSelectedUnit(null)}
        onReportProblem={handleReportProblem}
        reportedProblems={reportedProblems}
      />
    </div>
  );
}
