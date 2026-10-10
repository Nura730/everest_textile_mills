import { useState } from 'react';
import {
  BarChart2,
  Download,
  IndianRupee,
  TrendingUp,
  ShieldCheck,
  FileText,
  Filter,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { costBreakdown } from '../data/mockData';

export default function Reports() {
  const { auditTrail, orders } = useApp();
  const [activeTab, setActiveTab] = useState('costing');
  const [auditFilter, setAuditFilter] = useState('All');

  const filteredAudit = auditTrail.filter((evt) => {
    if (auditFilter === 'All') return true;
    return evt.action.includes(auditFilter);
  });

  return (
    <div className="erp-page-container">
      <div className="erp-page-header">
        <div className="erp-page-header-text">
          <h1 className="erp-page-title">Executive Reports & Costing</h1>
          <p className="erp-page-subtitle">
            Section 16 Cost Management, Order Margins, and Section 12 Append-Only Audit Log
          </p>
        </div>
        <div className="erp-page-actions">
          <button className="erp-btn-outline">
            <Download size={16} />
            <span>Export Executive PDF</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="erp-tabs-bar">
        <button
          className={`erp-tab-btn ${activeTab === 'costing' ? 'active' : ''}`}
          onClick={() => setActiveTab('costing')}
        >
          Factory Cost & Profitability (Section 16)
        </button>
        <button
          className={`erp-tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          Append-Only Audit Trail (Section 12)
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

          {/* Cost Allocation Breakdown Table */}
          <div className="erp-card" style={{ marginBottom: 20 }}>
            <div className="card-header">
              <div>
                <h3 className="card-title">Mill Cost Center Breakdown</h3>
                <p className="card-subtitle">
                  Direct material, direct labour, machine energy, and plant overheads
                </p>
              </div>
            </div>
            <div className="erp-table-wrapper">
              <table className="erp-data-table">
                <thead>
                  <tr>
                    <th>Cost Category</th>
                    <th>Actual Amount (₹)</th>
                    <th>Share of Operating Cost</th>
                    <th>Allocation Bar</th>
                  </tr>
                </thead>
                <tbody>
                  {costBreakdown.map((item) => (
                    <tr key={item.category}>
                      <td className="table-primary-cell">{item.category}</td>
                      <td>₹{item.amount.toLocaleString()}</td>
                      <td>{item.percentage}%</td>
                      <td style={{ width: 260 }}>
                        <div className="erp-progress-bar">
                          <div
                            className="erp-progress-fill"
                            style={{ width: `${item.percentage * 2}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Order Level Profitability Table */}
          <div className="erp-card">
            <div className="card-header">
              <div>
                <h3 className="card-title">Order-Level Profitability Analysis</h3>
                <p className="card-subtitle">
                  Per-order margin tracing for completed and in-production orders
                </p>
              </div>
            </div>
            <div className="erp-table-wrapper">
              <table className="erp-data-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Buyer</th>
                    <th>Fabric</th>
                    <th>Revenue</th>
                    <th>Yarn Cost</th>
                    <th>Labour Cost</th>
                    <th>Machine Cost</th>
                    <th>Net Profit</th>
                    <th>Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id}>
                      <td className="table-primary-cell">{o.id}</td>
                      <td>{o.customer}</td>
                      <td>{o.fabric}</td>
                      <td>₹{o.cost?.revenue?.toLocaleString() || '—'}</td>
                      <td>₹{o.cost?.material?.toLocaleString() || '—'}</td>
                      <td>₹{o.cost?.labour?.toLocaleString() || '—'}</td>
                      <td>₹{o.cost?.machine?.toLocaleString() || '—'}</td>
                      <td>
                        <strong>₹{o.cost?.profit?.toLocaleString() || '—'}</strong>
                      </td>
                      <td>
                        <span
                          className={`erp-status-badge ${
                            o.cost?.margin > 20 ? 'active' : 'error'
                          }`}
                        >
                          {o.cost?.margin}%
                        </span>
                      </td>
                    </tr>
                  ))}
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
              <h3 className="card-title">Append-Only Audit Log</h3>
              <p className="card-subtitle">
                Immutable record of all business state transitions, digital signatures, and operational events
              </p>
            </div>
            <div className="filter-chips-row">
              {['All', 'ORDER', 'MATERIAL', 'MACHINE', 'QC', 'DISPATCH'].map((f) => (
                <button
                  key={f}
                  className={`erp-filter-chip ${auditFilter === f ? 'active' : ''}`}
                  onClick={() => setAuditFilter(f)}
                >
                  {f}
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
                  <th>Actor / Role</th>
                  <th>Order Reference</th>
                  <th>Timestamp</th>
                  <th>Source</th>
                  <th>Event Description</th>
                </tr>
              </thead>
              <tbody>
                {filteredAudit.map((evt) => (
                  <tr key={evt.id}>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{evt.id}</td>
                    <td>
                      <span className="erp-status-badge neutral">{evt.action}</span>
                    </td>
                    <td>
                      <strong>{evt.actorName}</strong> ({evt.actorRole})
                    </td>
                    <td className="table-primary-cell">{evt.orderId}</td>
                    <td style={{ color: 'var(--color-gray-600)', fontSize: 12 }}>
                      {evt.timestamp}
                    </td>
                    <td>
                      <span className="text-xs">{evt.source}</span>
                    </td>
                    <td style={{ maxWidth: 360 }}>{evt.details}</td>
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
