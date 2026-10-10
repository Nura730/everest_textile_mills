import { useState } from 'react';
import { History, Search, Box, CheckCircle, ShieldAlert, Truck, Download } from 'lucide-react';
import { useApp } from '../context/AppContext';

export default function StockLedger() {
  const { stockLedger } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const filtered = stockLedger.filter((item) => {
    const matchesSearch =
      item.rollId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.orderId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.customer.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.fabric.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter =
      statusFilter === 'All' ||
      (statusFilter === 'In Store' && item.status.includes('In Store')) ||
      (statusFilter === 'Dispatched' && item.status === 'Dispatched') ||
      (statusFilter === 'Quarantine' && item.status.includes('Rework'));
    return matchesSearch && matchesFilter;
  });

  const inStoreCount = stockLedger.filter((s) => s.status.includes('In Store')).length;
  const dispatchedCount = stockLedger.filter((s) => s.status === 'Dispatched').length;
  const quarantineCount = stockLedger.filter((s) => s.qcStatus !== 'PASS').length;

  return (
    <div className="erp-page-container">
      <div className="erp-page-header">
        <div className="erp-page-header-text">
          <h1 className="erp-page-title">Stock Ledger — Finished Goods</h1>
          <p className="erp-page-subtitle">
            Section 17: Post-QC inspected fabric rolls, warehouse locations, and dispatch eligibility
          </p>
        </div>
        <div className="erp-page-actions">
          <button className="erp-btn-outline">
            <Download size={16} />
            <span>Export Ledger</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="erp-tall-kpi-grid" style={{ marginBottom: 20 }}>
        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Total Rolls Audited</span>
            <Box size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">{stockLedger.length}</div>
          <div className="tall-kpi-subtext">Cumulative post-QC rolls</div>
        </div>

        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Available In Warehouse</span>
            <CheckCircle size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">{inStoreCount}</div>
          <div className="tall-kpi-subtext">Eligible for dispatch</div>
        </div>

        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Dispatched Rolls</span>
            <Truck size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">{dispatchedCount}</div>
          <div className="tall-kpi-subtext">Shipped & Invoiced</div>
        </div>

        <div className={`erp-tall-kpi-card ${quarantineCount > 0 ? 'error' : ''}`}>
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Quarantine / Rework</span>
            <ShieldAlert size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">{quarantineCount}</div>
          <div className="tall-kpi-subtext" style={quarantineCount > 0 ? { color: 'var(--color-error)' } : {}}>
            Non-dispatchable (Defect)
          </div>
        </div>
      </div>

      {/* Filter and Search */}
      <div className="erp-filter-bar">
        <div className="filter-chips-row">
          {['All', 'In Store', 'Dispatched', 'Quarantine'].map((f) => (
            <button
              key={f}
              className={`erp-filter-chip ${statusFilter === f ? 'active' : ''}`}
              onClick={() => setStatusFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="erp-search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search roll ID, order, buyer..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="erp-card">
        <div className="erp-table-wrapper">
          <table className="erp-data-table">
            <thead>
              <tr>
                <th>Roll ID</th>
                <th>Source Order</th>
                <th>Buyer</th>
                <th>Fabric</th>
                <th>Quantity</th>
                <th>Net Weight</th>
                <th>Grade</th>
                <th>QC Status</th>
                <th>Warehouse Bin</th>
                <th>Dispatch Eligibility</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.rollId}>
                  <td className="table-primary-cell">{item.rollId}</td>
                  <td>{item.orderId}</td>
                  <td>{item.customer}</td>
                  <td>{item.fabric}</td>
                  <td>{item.meters.toLocaleString()} m</td>
                  <td>{item.weightKg} kg</td>
                  <td>
                    <span className="text-secondary">{item.grade}</span>
                  </td>
                  <td>
                    <span
                      className={`erp-status-badge ${
                        item.qcStatus === 'PASS' ? 'active' : 'error'
                      }`}
                    >
                      {item.qcStatus}
                    </span>
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{item.location}</td>
                  <td>
                    <span
                      className={`erp-status-badge ${
                        item.status === 'Dispatched'
                          ? 'neutral'
                          : item.status.includes('In Store')
                          ? 'active'
                          : 'error'
                      }`}
                    >
                      {item.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
