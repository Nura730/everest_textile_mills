import { useState } from 'react';
import { Plus, Search, Calendar, AlertCircle, ArrowRight, Download, CheckCircle2, X } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { boms } from '../data/mockData';

const statusFilters = ['All', 'Pending', 'In Production', 'Quality Check', 'Dispatched', 'Failed QC'];

export default function Orders() {
  const { orders, checkFeasibility, createOrder } = useApp();
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showNewModal, setShowNewModal] = useState(false);

  const [formData, setFormData] = useState({
    customer: 'Raymond Ltd.',
    fabric: 'Cotton Twill 2/1',
    quantity: 5000,
    deadline: '2026-10-24',
    machine: 'Rapier Loom A-12',
  });

  const [feasibility, setFeasibility] = useState(null);

  const filtered = orders.filter((order) => {
    const matchesFilter = activeFilter === 'All' || order.status === activeFilter;
    const matchesSearch =
      !searchTerm ||
      order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.customer.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.fabric.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const handleOpenNewModal = () => {
    const res = checkFeasibility(formData.fabric, formData.quantity, formData.deadline);
    setFeasibility(res);
    setShowNewModal(true);
  };

  const handleFormChange = (key, val) => {
    const next = { ...formData, [key]: val };
    setFormData(next);
    const res = checkFeasibility(next.fabric, next.quantity, next.deadline);
    setFeasibility(res);
  };

  const handleCreateSubmit = (e) => {
    e.preventDefault();
    createOrder(formData);
    setShowNewModal(false);
  };

  return (
    <div className="erp-page-container">
      <div className="erp-page-header">
        <div className="erp-page-header-text">
          <h1 className="erp-page-title">Manufacturing Orders</h1>
          <p className="erp-page-subtitle">
            Section 4 & 5: Order Feasibility Validation, Material Reservation, and State Machine Tracking
          </p>
        </div>
        <div className="erp-page-actions">
          <button className="erp-btn-outline">
            <Download size={16} />
            <span>Export Orders</span>
          </button>
          <button className="erp-btn-primary" onClick={handleOpenNewModal}>
            <Plus size={16} />
            <span>New Order</span>
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="erp-filter-bar">
        <div className="filter-chips-row">
          {statusFilters.map((filter) => (
            <button
              key={filter}
              className={`erp-filter-chip ${activeFilter === filter ? 'active' : ''}`}
              onClick={() => setActiveFilter(filter)}
            >
              {filter}
              {filter === 'Failed QC' &&
                orders.filter((o) => o.status === 'Failed QC').length > 0 && (
                  <span className="filter-chip-badge error">
                    {orders.filter((o) => o.status === 'Failed QC').length}
                  </span>
                )}
            </button>
          ))}
        </div>
        <div className="erp-search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search orders, clients, fabrics..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Orders Table */}
      <div className="erp-card">
        <div className="erp-table-wrapper">
          <table className="erp-data-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Buyer</th>
                <th>Fabric</th>
                <th>Quantity</th>
                <th>Yarn Batch</th>
                <th>Allocated Loom</th>
                <th>Deadline</th>
                <th>Progress</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => {
                const deadlineDate = new Date(order.deadline);
                const today = new Date();
                const daysLeft = Math.ceil((deadlineDate - today) / (1000 * 60 * 60 * 24));
                const isOverdue = daysLeft < 0 && order.status !== 'Dispatched';
                const isUrgent = daysLeft <= 3 && daysLeft >= 0 && order.status !== 'Dispatched';

                return (
                  <tr key={order.id}>
                    <td className="table-primary-cell">{order.id}</td>
                    <td>{order.customer}</td>
                    <td>{order.fabric}</td>
                    <td>
                      {order.quantity.toLocaleString()} {order.unit}
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--color-gray-600)' }}>
                      {order.yarnRequired}
                    </td>
                    <td>{order.machine}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Calendar size={13} style={{ color: 'var(--color-gray-400)' }} />
                        <span>{order.deadline}</span>
                        {isOverdue && <span className="erp-status-badge error">Overdue</span>}
                        {isUrgent && (
                          <span className="erp-status-badge outline">{daysLeft}d left</span>
                        )}
                      </div>
                    </td>
                    <td style={{ minWidth: 120 }}>
                      <div className="table-progress-wrap">
                        <div className="erp-progress-bar">
                          <div
                            className={`erp-progress-fill ${
                              order.status === 'Failed QC' ? 'error' : ''
                            }`}
                            style={{ width: `${order.progress}%` }}
                          />
                        </div>
                        <span className="table-progress-text">{order.progress}%</span>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`erp-status-badge ${
                          order.status === 'Failed QC'
                            ? 'error'
                            : order.status === 'In Production'
                            ? 'active'
                            : order.status === 'Dispatched'
                            ? 'neutral'
                            : 'outline'
                        }`}
                      >
                        {order.status === 'Failed QC' && (
                          <AlertCircle size={11} style={{ marginRight: 3 }} />
                        )}
                        {order.status}
                      </span>
                    </td>
                    <td>
                      <button
                        className="erp-btn-icon-sm"
                        onClick={() => setSelectedOrder(order)}
                        title="View State Machine & Buyer Timeline"
                      >
                        <ArrowRight size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: New Manufacturing Order with Feasibility Validation */}
      {showNewModal && (
        <div className="erp-modal-overlay">
          <div className="erp-modal-box large">
            <div className="modal-header">
              <div>
                <h3 className="modal-title">Create Manufacturing Order & Check Feasibility</h3>
                <p className="modal-subtitle">
                  Section 5 Feasibility Check: Material reserve, machine capacity, duration buffer
                </p>
              </div>
              <button className="modal-close-btn" onClick={() => setShowNewModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit}>
              <div className="modal-body">
                <div className="erp-form-grid">
                  <div className="form-group">
                    <label className="erp-label">Buyer Name</label>
                    <input
                      type="text"
                      className="erp-input"
                      value={formData.customer}
                      onChange={(e) => handleFormChange('customer', e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="erp-label">Fabric Variety / BOM</label>
                    <select
                      className="erp-select"
                      value={formData.fabric}
                      onChange={(e) => handleFormChange('fabric', e.target.value)}
                    >
                      {boms.map((b) => (
                        <option key={b.id} value={b.fabric}>
                          {b.fabric} ({b.yarn})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="erp-label">Quantity (Meters)</label>
                    <input
                      type="number"
                      className="erp-input"
                      step="500"
                      min="500"
                      value={formData.quantity}
                      onChange={(e) => handleFormChange('quantity', Number(e.target.value))}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="erp-label">Delivery Deadline</label>
                    <input
                      type="date"
                      className="erp-input"
                      value={formData.deadline}
                      onChange={(e) => handleFormChange('deadline', e.target.value)}
                      required
                    />
                  </div>
                </div>

                {/* Feasibility Check Output */}
                {feasibility && (
                  <div
                    className={`feasibility-result-panel ${
                      feasibility.isFeasible ? 'feasible' : 'not-feasible'
                    }`}
                  >
                    <div className="feasibility-verdict-row">
                      <div className="feasibility-badge-wrap">
                        {feasibility.isFeasible ? (
                          <>
                            <CheckCircle2 size={20} className="feasibility-icon-success" />
                            <div>
                              <strong className="feasibility-verdict-text">
                                FEASIBLE ORDER COMMITMENT
                              </strong>
                              <div className="text-xs text-secondary">
                                Yarn stock and loom schedule fully verified.
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <AlertCircle size={20} className="feasibility-icon-error" />
                            <div>
                              <strong className="feasibility-verdict-text error">
                                HIGH PRODUCTION RISK / INFEASIBLE
                              </strong>
                              <div className="text-xs text-secondary">
                                Bottleneck identified in material or scheduling.
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="feasibility-metrics-summary">
                      <div className="feasibility-metric-box">
                        <span className="text-xs text-secondary">Required Yarn</span>
                        <strong>{feasibility.requiredYarnKg.toLocaleString()} kg</strong>
                      </div>
                      <div className="feasibility-metric-box">
                        <span className="text-xs text-secondary">Available Stock</span>
                        <strong
                          style={
                            feasibility.availableYarn < feasibility.requiredYarnKg
                              ? { color: 'var(--color-error)' }
                              : {}
                          }
                        >
                          {feasibility.availableYarn.toLocaleString()} kg
                        </strong>
                      </div>
                      <div className="feasibility-metric-box">
                        <span className="text-xs text-secondary">Duration Required</span>
                        <strong>{feasibility.productionDaysNeeded} days</strong>
                      </div>
                      <div className="feasibility-metric-box">
                        <span className="text-xs text-secondary">Deadline Buffer</span>
                        <strong
                          style={
                            feasibility.deadlineDays < feasibility.productionDaysNeeded
                              ? { color: 'var(--color-error)' }
                              : {}
                          }
                        >
                          {feasibility.deadlineDays} days
                        </strong>
                      </div>
                    </div>

                    <div className="feasibility-reasons-list">
                      {feasibility.reasons.map((r, i) => (
                        <div key={i} className="feasibility-reason-item">
                          • {r}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="erp-btn-outline"
                  onClick={() => setShowNewModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="erp-btn-primary"
                  disabled={!feasibility?.isFeasible}
                >
                  {feasibility?.isFeasible
                    ? 'Confirm Order & Reserve Material'
                    : 'Override Warning (Admin Only)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DRAWER / MODAL: Order Detail & State Machine Lifecycle */}
      {selectedOrder && (
        <div className="erp-modal-overlay">
          <div className="erp-modal-box large">
            <div className="modal-header">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h3 className="modal-title">{selectedOrder.id} — Order Lifecycle</h3>
                  <span
                    className={`erp-status-badge ${
                      selectedOrder.status === 'Failed QC' ? 'error' : 'active'
                    }`}
                  >
                    {selectedOrder.status}
                  </span>
                </div>
                <p className="modal-subtitle">
                  {selectedOrder.customer} • {selectedOrder.quantity.toLocaleString()} {selectedOrder.unit} {selectedOrder.fabric}
                </p>
              </div>
              <button className="modal-close-btn" onClick={() => setSelectedOrder(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              {/* Buyer Facing Timeline (Section 19) */}
              <div className="order-detail-section">
                <h4 className="detail-section-title">Buyer Status Lifecycle Timeline</h4>
                <div className="buyer-timeline">
                  {selectedOrder.timeline.map((step, idx) => (
                    <div
                      key={step.step}
                      className={`timeline-step ${
                        step.done ? 'completed' : step.current ? 'current' : 'upcoming'
                      } ${step.error ? 'error' : ''}`}
                    >
                      <div className="timeline-node">
                        {step.done ? (
                          '✓'
                        ) : step.error ? (
                          '!'
                        ) : (
                          idx + 1
                        )}
                      </div>
                      <div className="timeline-info">
                        <div className="timeline-label">{step.label}</div>
                        <div className="timeline-date">{step.date}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Manufacturing State Machine Attributes */}
              <div className="order-detail-grid">
                <div className="detail-box">
                  <span className="detail-label">Allocated Loom</span>
                  <strong className="detail-val">{selectedOrder.machine}</strong>
                </div>
                <div className="detail-box">
                  <span className="detail-label">Required Yarn Batch</span>
                  <strong className="detail-val">{selectedOrder.yarnRequired}</strong>
                </div>
                <div className="detail-box">
                  <span className="detail-label">Delivery Deadline</span>
                  <strong className="detail-val">{selectedOrder.deadline}</strong>
                </div>
                <div className="detail-box">
                  <span className="detail-label">Production Progress</span>
                  <strong className="detail-val">{selectedOrder.progress}% completed</strong>
                </div>
              </div>

              {/* Cost & Profitability Analysis (Section 16) */}
              {selectedOrder.cost && (
                <div className="order-detail-section" style={{ marginTop: 20 }}>
                  <h4 className="detail-section-title">Cost & Profitability Analysis (Section 16)</h4>
                  <div className="cost-breakdown-table">
                    <div className="cost-row">
                      <span>Order Gross Revenue</span>
                      <strong>₹{selectedOrder.cost.revenue.toLocaleString()}</strong>
                    </div>
                    <div className="cost-row sub">
                      <span>• Raw Material (Yarn) Cost</span>
                      <span>- ₹{selectedOrder.cost.material.toLocaleString()}</span>
                    </div>
                    <div className="cost-row sub">
                      <span>• Operating Labour & Wages</span>
                      <span>- ₹{selectedOrder.cost.labour.toLocaleString()}</span>
                    </div>
                    <div className="cost-row sub">
                      <span>• Machine Energy & Loom Overheads</span>
                      <span>- ₹{selectedOrder.cost.machine.toLocaleString()}</span>
                    </div>
                    {selectedOrder.cost.rework > 0 && (
                      <div className="cost-row sub error">
                        <span>• QC Rework & Waste Loss</span>
                        <span>- ₹{selectedOrder.cost.rework.toLocaleString()}</span>
                      </div>
                    )}
                    <div className="cost-row total">
                      <span>Net Operating Margin</span>
                      <strong style={{ color: selectedOrder.cost.margin > 20 ? 'var(--color-black)' : 'var(--color-error)' }}>
                        ₹{selectedOrder.cost.profit.toLocaleString()} ({selectedOrder.cost.margin}% margin)
                      </strong>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="erp-btn-outline" onClick={() => setSelectedOrder(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
