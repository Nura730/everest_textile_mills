import { useState } from 'react';
import { Download, IndianRupee, TrendingUp } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { exportToCSV } from '../utils/csvExport';

export default function Reports() {
  const { auditTrail, orders, toast } = useApp();
  const [activeTab, setActiveTab] = useState('costing');
  const [auditFilter, setAuditFilter] = useState('All');

  const filteredAudit = auditTrail.filter((evt) => {
    if (auditFilter === 'All') return true;
    return evt.action.includes(auditFilter);
  });

  const handleExportPDF = () => {
    toast.info('Preparing Executive Report print / PDF preview...', 'Report Generated');
    window.print();
  };

  const handleExportAuditTrail = () => {
    const success = exportToCSV('audit_trail_log', auditTrail, [
      { key: 'id', label: 'Audit ID' },
      { key: 'action', label: 'Action Event' },
      { key: 'actorName', label: 'Actor Name' },
      { key: 'actorRole', label: 'Actor Role' },
      { key: 'orderId', label: 'Order Reference' },
      { key: 'timestamp', label: 'Timestamp' },
      { key: 'source', label: 'Cache Source' },
      { key: 'details', label: 'Event Details' },
    ]);
    if (success) {
      toast.success('Audit trail log exported to CSV successfully.', 'Export Complete');
    }
  };

  return (
    <div className="erp-page-container">
      <div className="erp-page-header">
        <div className="erp-page-header-text">
          <h1 className="erp-page-title">Executive Reports & Costing</h1>
          <p className="erp-page-subtitle">
            Cost Management, Order Margins, and Append-Only Audit Log
          </p>
        </div>
        <div className="erp-page-actions">
          {activeTab === 'audit' && (
            <button type="button" className="erp-btn-outline" onClick={handleExportAuditTrail} title="Export audit trail to CSV">
              <Download size={16} />
              <span>Export Audit CSV</span>
            </button>
          )}
          <button type="button" className="erp-btn-primary" onClick={handleExportPDF} title="Print or save PDF of current report">
            <Download size={16} />
            <span>Export Executive PDF</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="erp-tabs-bar">
        <button
          type="button"
          className={`erp-tab-btn ${activeTab === 'costing' ? 'active' : ''}`}
          onClick={() => setActiveTab('costing')}
        >
          Factory Cost & Profitability
        </button>
        <button
          type="button"
          className={`erp-tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          Append-Only Audit Trail
        </button>
      </div>

      {activeTab === 'costing' && (
        <div>
          {/* Top KPI Cards */}
          <div className="erp-tall-kpi-grid" style={{ marginBottom: 20 }}>
            <div className="erp-tall-kpi-card">
              <div className="tall-kpi-header">
                <span className="tall-kpi-label">Gross Revenue</span>
                <IndianRupee size={16} className="tall-kpi-icon" />
              </div>
              <div className="tall-kpi-value">₹1,840,000</div>
              <div className="tall-kpi-change">+8.2% from last month</div>
            </div>

            <div className="erp-tall-kpi-card">
              <div className="tall-kpi-header">
                <span className="tall-kpi-label">Total Manufacturing Cost</span>
                <IndianRupee size={16} className="tall-kpi-icon" />
              </div>
              <div className="tall-kpi-value">₹1,350,000</div>
              <div className="tall-kpi-subtext">Material + Labour + Power</div>
            </div>

            <div className="erp-tall-kpi-card">
              <div className="tall-kpi-header">
                <span className="tall-kpi-label">Net Operating Margin</span>
                <TrendingUp size={16} className="tall-kpi-icon" />
              </div>
              <div className="tall-kpi-value">26.6%</div>
              <div className="tall-kpi-change">+1.4% margin improvement</div>
            </div>

            <div className="erp-tall-kpi-card error">
              <div className="tall-kpi-header">
                <span className="tall-kpi-label">Rework & Defect Waste</span>
                <IndianRupee size={16} className="tall-kpi-icon" />
              </div>
              <div className="tall-kpi-value" style={{ color: 'var(--color-error)' }}>
                ₹68,400
              </div>
              <div className="tall-kpi-subtext" style={{ color: 'var(--color-error)' }}>
                Loom C-05 tension defect loss
              </div>
            </div>
          </div>

          {/* Orders Costing Breakdown Table */}
          <div className="erp-card">
            <div className="card-header">
              <div>
                <h3 className="card-title">Order-Level Unit Cost & Margin Analysis</h3>
                <p className="card-subtitle">
                  Direct material, operator labour, machine energy, and post-QC rework charges
                </p>
              </div>
            </div>
            <div className="erp-table-wrapper">
              <table className="erp-data-table">
                <thead>
                  <tr>
                    <th>Order Reference</th>
                    <th>Customer</th>
                    <th>Fabric Quality</th>
                    <th>Meters Produced</th>
                    <th>Yarn Material Cost</th>
                    <th>Labour Cost</th>
                    <th>Machine Cost</th>
                    <th>Total Cost</th>
                    <th>Revenue</th>
                    <th>Gross Margin (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => {
                    if (!order.cost) return null;
                    const totalCost =
                      order.cost.material + order.cost.labour + order.cost.machine + order.cost.rework;
                    return (
                      <tr key={order.id}>
                        <td className="table-primary-cell font-mono">{order.id}</td>
                        <td>{order.customer}</td>
                        <td>{order.fabric}</td>
                        <td>{order.quantity.toLocaleString()} m</td>
                        <td>₹{order.cost.material.toLocaleString()}</td>
                        <td>₹{order.cost.labour.toLocaleString()}</td>
                        <td>₹{order.cost.machine.toLocaleString()}</td>
                        <td style={{ fontWeight: 600 }}>₹{totalCost.toLocaleString()}</td>
                        <td style={{ fontWeight: 600 }}>₹{order.cost.revenue.toLocaleString()}</td>
                        <td>
                          <span
                            className={`erp-status-badge ${
                              order.cost.margin > 25 ? 'active' : 'outline'
                            }`}
                          >
                            {order.cost.margin}%
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'audit' && (
        <div className="erp-card">
          <div className="card-header">
            <div>
              <h3 className="card-title">Immutable Audit Trail Log</h3>
              <p className="card-subtitle">
                Cryptographically tracked chronological events with actor signatures and offline sync verification
              </p>
            </div>
          </div>

          <div className="erp-filter-bar" style={{ marginBottom: 12 }}>
            <div className="filter-chips-row">
              {['All', 'ORDER', 'QC', 'DISPATCH', 'MACHINE'].map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`erp-filter-chip ${auditFilter === f ? 'active' : ''}`}
                  onClick={() => setAuditFilter(f)}
                >
                  {f === 'All' ? 'All Events' : `${f} Events`}
                </button>
              ))}
            </div>
          </div>

          <div className="erp-table-wrapper">
            <table className="erp-data-table">
              <thead>
                <tr>
                  <th>Audit ID</th>
                  <th>Action Event</th>
                  <th>Actor & Persona</th>
                  <th>Order Reference</th>
                  <th>Source</th>
                  <th>Timestamp</th>
                  <th>Technical Details & Payload</th>
                </tr>
              </thead>
              <tbody>
                {filteredAudit.map((evt) => (
                  <tr key={evt.id}>
                    <td className="table-primary-cell font-mono">{evt.id}</td>
                    <td>
                      <span className="erp-status-badge active">{evt.action}</span>
                    </td>
                    <td>
                      <div>
                        <strong>{evt.actorName}</strong>
                        <div className="text-xs text-secondary">{evt.actorRole}</div>
                      </div>
                    </td>
                    <td className="font-mono">{evt.orderId}</td>
                    <td>
                      <span
                        className={`erp-status-badge ${
                          evt.source === 'ONLINE' ? 'neutral' : 'outline'
                        }`}
                      >
                        {evt.source}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--color-gray-600)' }}>
                      {evt.timestamp}
                    </td>
                    <td style={{ fontSize: 12, maxWidth: 350 }}>{evt.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
