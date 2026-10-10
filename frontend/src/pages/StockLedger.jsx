import { useState, useMemo } from 'react';
import { History, Search, Box, CheckCircle, ShieldAlert, Truck, Download, AlertCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { exportToCSV } from '../utils/csvExport';

export default function StockLedger() {
  const { stockLedger, toast } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');

  const filtered = useMemo(() => {
    return stockLedger.filter((item) => {
      const matchesSearch =
        item.rollId.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        item.orderId.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        item.customer.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        item.fabric.toLowerCase().includes(searchTerm.toLowerCase().trim());
      const matchesFilter =
        statusFilter === 'All' ||
        (statusFilter === 'In Store' && item.status.includes('In Store')) ||
        (statusFilter === 'Dispatched' && item.status === 'Dispatched') ||
        (statusFilter === 'Quarantine' && item.status.includes('Rework'));
      return matchesSearch && matchesFilter;
    });
  }, [stockLedger, searchTerm, statusFilter]);

  const inStoreCount = stockLedger.filter((s) => s.status.includes('In Store')).length;
  const dispatchedCount = stockLedger.filter((s) => s.status === 'Dispatched').length;
  const quarantineCount = stockLedger.filter((s) => s.qcStatus !== 'PASS').length;

  const handleExportLedger = () => {
    const success = exportToCSV('finished_goods_stock_ledger', stockLedger, [
      { key: 'rollId', label: 'Roll Barcode' },
      { key: 'orderId', label: 'Manufacturing Order' },
      { key: 'customer', label: 'Buyer Enterprise' },
      { key: 'fabric', label: 'Fabric Variety' },
      { key: 'length', label: 'Inspected Length (m)' },
      { key: 'qcStatus', label: 'ASTM QC Grade' },
      { key: 'location', label: 'Warehouse Bin' },
      { key: 'status', label: 'Storage Status' },
    ]);
    if (success) {
      toast.success('Finished goods stock ledger exported to CSV successfully.', 'Export Complete');
    }
  };

  return (
    <div className="erp-page-container">
      <div className="erp-page-header">
        <div className="erp-page-header-text">
          <h1 className="erp-page-title">Stock Ledger — Finished Goods</h1>
          <p className="erp-page-subtitle">
            Post-QC inspected fabric rolls, warehouse locations, and dispatch eligibility
          </p>
        </div>
        <div className="erp-page-actions">
          <button type="button" className="erp-btn-outline" onClick={handleExportLedger} title="Export finished goods to CSV">
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
            <span className="tall-kpi-label">Rework & Quarantine</span>
            <AlertCircle size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value" style={quarantineCount > 0 ? { color: 'var(--color-error)' } : {}}>
            {quarantineCount}
          </div>
          <div className="tall-kpi-subtext" style={quarantineCount > 0 ? { color: 'var(--color-error)' } : {}}>
            ASTM 4-Point failures
          </div>
        </div>
      </div>

      {/* Filters and Search Bar */}
      <div className="erp-filter-bar">
        <div className="filter-chips-row">
          {['All', 'In Store', 'Dispatched', 'Quarantine'].map((status) => (
            <button
              key={status}
              type="button"
              className={`erp-filter-chip ${statusFilter === status ? 'active' : ''}`}
              onClick={() => setStatusFilter(status)}
            >
              {status}
            </button>
          ))}
        </div>
        <div className="erp-search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search roll ID, order, customer, fabric..."
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

      {/* Ledger Table */}
      <div className="erp-card">
        <div className="erp-table-wrapper">
          <table className="erp-data-table">
            <thead>
              <tr>
                <th>Roll Identifier</th>
                <th>Order Ref</th>
                <th>Buyer / Client</th>
                <th>Fabric Variety</th>
                <th>Roll Length</th>
                <th>QC Grade</th>
                <th>Warehouse Rack Location</th>
                <th>Dispatch Eligibility</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.rollId}>
                  <td className="table-primary-cell font-mono">{item.rollId}</td>
                  <td className="font-mono">{item.orderId}</td>
                  <td>{item.customer}</td>
                  <td>{item.fabric}</td>
                  <td>{item.length} m</td>
                  <td>
                    <span
                      className={`erp-status-badge ${
                        item.qcStatus === 'PASS' ? 'active' : 'error'
                      }`}
                    >
                      {item.qcStatus}
                    </span>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--color-gray-600)' }}>
                    {item.location}
                  </td>
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
