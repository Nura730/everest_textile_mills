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
import { machinesApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ROLE_LABELS, ROLES } from '../auth/roles.js';
import { ErrorState, LoadingState } from '../components/ui/States.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { liveMatch, useLive } from '../realtime/realtimeBus.js';
import { formatDateTime } from '../utils/format.js';
import { FLOOR_LEGEND, SECTION_BY_TYPE, floorCounts, toFloorUnit } from '../utils/floorMap.js';
import { factorySections as allFactorySections } from '../data/factoryFloorData';
import FactorySection from '../components/FactorySection';

// Only the sections that hold machines in the system (by machine type); storage, QC and dispatch bays are
// not machine records, so they are not drawn.
const factorySections = allFactorySections.filter((s) => Object.values(SECTION_BY_TYPE).includes(s.id));

/** Every machine record (active and retired), page by page (the list API returns at most 100 a page). */
async function loadAllMachines() {
  const machines = [];
  for (const isActive of [true, false]) {
    for (let page = 1; ; page += 1) {
      const { data, meta } = await machinesApi.list({ isActive, limit: 100, page });
      machines.push(...data.machines);
      if (page * 100 >= (meta?.total ?? 0)) break;
    }
  }
  return { data: { machines, loadedAt: new Date() } };
}

const STATUS_OPTIONS = [
  { value: 'ALL', label: 'All Statuses' },
  { value: 'RUNNING', label: 'Running' },
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'ASSIGNED', label: 'Idle (assigned)' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
  { value: 'DOWN', label: 'Down (Critical)' },
  { value: 'OUT_OF_SERVICE', label: 'Out of service' },
];

export default function Machines() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const currentRole = user ? { id: user.role, name: ROLE_LABELS[user.role] ?? user.role } : null;

  // Role-Based Access Control: only Admin and Floor Manager (the server also enforces machine access)
  const isAuthorized = Boolean(user) && (user.role === ROLES.ADMIN || user.role === ROLES.FLOOR_MANAGER);

  // The machine records from the backend; refreshed whenever a machine or run change is recorded.
  const machines = useApiQuery(() => (isAuthorized ? loadAllMachines() : Promise.resolve({ data: { machines: [] } })), [isAuthorized], { cacheKey: 'floor-map:machines' });
  useLive(liveMatch.actions('MACHINE_', 'RUN_'), machines.reload);
  const factoryUnits = useMemo(() => (machines.data?.machines ?? []).map((m) => toFloorUnit(m, factorySections)), [machines.data]);

  // Search & Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSection, setSelectedSection] = useState('ALL');
  const [selectedStatus, setSelectedStatus] = useState('ALL');

  // A tile opens the machine's own page (status history, problems, maintenance).
  const openUnit = (unit) => navigate(`/machines/${unit.machineId}`);

  // KPI counts from the backend machine records
  const kpis = useMemo(() => floorCounts(factoryUnits), [factoryUnits]);

  // Filtered dataset
  const filteredUnits = useMemo(() => {
    return factoryUnits.filter((unit) => {
      // Search term: ID, Name, Order, Type, Section
      const matchesSearch =
        searchTerm.trim() === '' ||
        unit.id.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        unit.name.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        (unit.location && unit.location.toLowerCase().includes(searchTerm.toLowerCase().trim())) ||
        (unit.type && unit.type.toLowerCase().includes(searchTerm.toLowerCase().trim())) ||
        unit.section.toLowerCase().includes(searchTerm.toLowerCase().trim());

      // Section filter
      const matchesSection = selectedSection === 'ALL' || unit.sectionId === selectedSection;

      // Status filter
      const matchesStatus = selectedStatus === 'ALL' || unit.status === selectedStatus;

      return matchesSearch && matchesSection && matchesStatus;
    });
  }, [factoryUnits, searchTerm, selectedSection, selectedStatus]);

  // Dynamic Summary Table counts by section
  const summaryTableData = useMemo(() => {
    return factorySections.map((sec) => {
      const { total, ...counts } = floorCounts(factoryUnits.filter((u) => u.sectionId === sec.id));
      return { sectionId: sec.id, sectionName: sec.name, prefix: sec.prefix, count: total, ...counts };
    });
  }, [factoryUnits]);

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
            The Factory Floor Map is restricted to{' '}
            <strong>Admin</strong> and <strong>Floor Manager</strong> roles.
          </p>
          <div className="restricted-role-info">
            <span className="text-xs text-muted">CURRENT LOGGED-IN IDENTITY:</span>
            <div className="restricted-role-pill">
              <strong>{currentRole?.name || 'Unknown User'}</strong>
              <span className="restricted-role-id">({currentRole?.id || 'NO_ROLE'})</span>
            </div>
            <p className="text-xs text-secondary" style={{ marginTop: 8 }}>
              Ask an <strong>Admin</strong> if you need access.
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
          </div>
          <p className="factory-main-subtitle">
            Machines by factory section, coloured by their recorded status (updated when a change is recorded; not sensor telemetry).
          </p>
        </div>

        <div className="factory-header-right">
          <div className="factory-last-updated-box">
            <Clock size={14} className="text-muted" />
            <span>Loaded: {machines.data?.loadedAt ? formatDateTime(machines.data.loadedAt) : '—'}</span>
          </div>
        </div>
      </div>

      {/* 5. Summary KPI Cards (Monochrome + Red for DOWN) */}
      <div className="factory-kpi-grid">
        <div className="factory-kpi-card" title="Every machine record, including retired machines">
          <div className="factory-kpi-card-header">
            <span className="factory-kpi-label">Total Units</span>
            <Box size={16} className="text-muted" />
          </div>
          <div className="factory-kpi-value">{kpis.total}</div>
          <div className="factory-kpi-meta">Machines in {factorySections.length} sections</div>
        </div>

        <div className="factory-kpi-card floor-kpi-running" title="Running a production run">
          <div className="factory-kpi-card-header">
            <span className="factory-kpi-label">Running</span>
            <Activity size={16} className="text-muted" />
          </div>
          <div className="factory-kpi-value">{kpis.running}</div>
          <div className="factory-kpi-meta">{kpis.total ? ((kpis.running / kpis.total) * 100).toFixed(0) : 0}% of machines running</div>
        </div>

        <div className="factory-kpi-card floor-kpi-idle" title="Free for a new production run">
          <div className="factory-kpi-card-header">
            <span className="factory-kpi-label">Available</span>
            <CheckCircle2 size={16} className="text-muted" />
          </div>
          <div className="factory-kpi-value">{kpis.available}</div>
          <div className="factory-kpi-meta">Free for production</div>
        </div>

        <div className="factory-kpi-card floor-kpi-idle" title="Assigned to a run that has not started, or paused">
          <div className="factory-kpi-card-header">
            <span className="factory-kpi-label">Idle</span>
            <Play size={16} className="text-muted" />
          </div>
          <div className="factory-kpi-value">{kpis.idle + kpis.paused}</div>
          <div className="factory-kpi-meta">Assigned {kpis.idle} · paused {kpis.paused}</div>
        </div>

        <div className="factory-kpi-card floor-kpi-maintenance" title="In maintenance">
          <div className="factory-kpi-card-header">
            <span className="factory-kpi-label">Maintenance</span>
            <Wrench size={16} className="text-muted" />
          </div>
          <div className="factory-kpi-value">{kpis.maintenance}</div>
          <div className="factory-kpi-meta">Cost recorded when it finishes</div>
        </div>

        <div className="factory-kpi-card kpi-card-down" title="Down after a reported problem, or retired (out of service)">
          <div className="factory-kpi-card-header">
            <span className="factory-kpi-label text-red">Down</span>
            <AlertOctagon size={16} className="text-red" />
          </div>
          <div className="factory-kpi-value text-red">{kpis.down}</div>
          <div className="factory-kpi-meta text-red">Not working or out of service</div>
        </div>
      </div>

      {/* 6. Search and Filter Bar */}
      <div className="factory-filter-bar">
        <div className="factory-search-wrap">
          <Search size={16} className="factory-search-icon" />
          <input
            type="text"
            className="factory-search-input"
            placeholder="Search by machine code (e.g. W-03), name, location, or section..."
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
              <option value="ALL">All Sections ({factorySections.length})</option>
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

      {/* Status colour legend */}
      <div className="floor-legend" aria-label="Status colours">
        {FLOOR_LEGEND.map((l) => (
          <span key={l.tone} className="floor-legend-item">
            <span className={`floor-legend-swatch floor-tone-${l.tone}`} aria-hidden="true" />
            {l.label}
          </span>
        ))}
      </div>

      {/* 7. Factory Floor Map Section Grid */}
      <main className="factory-map-main-area">
        {machines.error ? (
          <ErrorState error={machines.error} onRetry={machines.reload} />
        ) : !machines.data ? (
          <LoadingState label="Loading machines…" />
        ) : filteredUnits.length === 0 ? (
          <div className="factory-global-empty-state">
            <AlertTriangle size={32} className="text-muted" style={{ marginBottom: 12 }} />
            <h3>{factoryUnits.length === 0 ? 'No machines recorded yet' : 'No Factory Units Match Your Criteria'}</h3>
            <p className="text-muted text-sm">
              {factoryUnits.length === 0 ? 'Add machines on the Machines page; they appear here by type.' : <>No machines found matching &ldquo;{searchTerm}&rdquo; with the selected filters.</>}
            </p>
            <button
              type="button"
              className="factory-btn-primary"
              style={{ marginTop: 14 }}
              onClick={clearFilters}
            >
              Reset Filters & Show All Units
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
                  selectedUnit={null}
                  onSelectUnit={openUnit}
                />
              );
            })}
          </div>
        )}
      </main>

      {/* 12. Summary Table (from the machine records) */}
      <section className="factory-summary-table-section" aria-labelledby="summary-table-title">
        <div className="summary-table-header">
          <div>
            <h2 id="summary-table-title" className="summary-table-title">
              Factory Unit Distribution & Status Summary
            </h2>
            <p className="summary-table-subtitle">
              Machines by section and recorded status.
            </p>
          </div>
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
                <th scope="col" style={{ width: '10%' }} className="text-right">Assigned</th>
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
                <td className="font-mono text-xs text-muted">All {factorySections.length} Sections</td>
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
            * Down includes retired (out of service) machines. Totals: {kpis.running} Running + {kpis.available} Available + {kpis.idle} Assigned + {kpis.paused} Paused + {kpis.maintenance} Maintenance + {kpis.down} Down = {kpis.total} Total.
          </span>
        </div>
      </section>

    </div>
  );
}
