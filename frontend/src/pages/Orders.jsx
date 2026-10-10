import { useState, useMemo } from 'react';
import {
  Plus,
  Search,
  Calendar,
  AlertCircle,
  ArrowRight,
  Download,
  CheckCircle2,
  X,
  ArrowUpDown,
  Trash2,
  Package,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { boms } from '../data/mockData';
import { exportToCSV } from '../utils/csvExport';
import ConfirmDialog from '../components/ConfirmDialog';

const statusFilters = ['All', 'Pending', 'In Production', 'Quality Check', 'Dispatched', 'Failed QC', 'Cancelled'];

export default function Orders() {
  const { orders, checkFeasibility, createOrder, cancelOrder, toast } = useApp();
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [orderToCancel, setOrderToCancel] = useState(null);

  // Sorting state
  const [sortBy, setSortBy] = useState('deadline');
  const [sortDirection, setSortDirection] = useState('asc');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 6;

  const [formData, setFormData] = useState({
    customer: 'Raymond Ltd.',
    fabric: 'Cotton Twill 2/1',
    quantity: 5000,
    deadline: '2026-10-24',
    machine: 'Rapier Loom A-12',
  });

  const [feasibility, setFeasibility] = useState(null);

  // Filter and sort
  const filtered = useMemo(() => {
    let result = orders.filter((order) => {
      const matchesFilter = activeFilter === 'All' || order.status === activeFilter;
      const matchesSearch =
        !searchTerm ||
        order.id.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        order.customer.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        order.fabric.toLowerCase().includes(searchTerm.toLowerCase().trim());
      return matchesFilter && matchesSearch;
    });

    result.sort((a, b) => {
      let aVal = a[sortBy];
      let bVal = b[sortBy];
      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = bVal.toLowerCase();
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [orders, activeFilter, searchTerm, sortBy, sortDirection]);

  // Paginated slice
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginatedOrders = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(field);
      setSortDirection('asc');
    }
  };

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

  const handleExportOrders = () => {
    const success = exportToCSV('manufacturing_orders', orders, [
      { key: 'id', label: 'Order ID' },
      { key: 'customer', label: 'Buyer / Client' },
      { key: 'fabric', label: 'Fabric Quality' },
      { key: 'quantity', label: 'Quantity (Meters)' },
      { key: 'yarnRequired', label: 'Yarn Lot Required' },
      { key: 'machine', label: 'Assigned Loom' },
      { key: 'deadline', label: 'Target Deadline' },
      { key: 'progress', label: 'Progress (%)' },
      { key: 'status', label: 'Operational Status' },
    ]);
    if (success) {
      toast.success('Manufacturing orders exported to CSV successfully.', 'Export Complete');
    }
  };

  return (
    <div className="erp-page-container">
      <div className="erp-page-header">
        <div className="erp-page-header-text">
          <h1 className="erp-page-title">Manufacturing Orders</h1>
          <p className="erp-page-subtitle">
            Order Feasibility Validation, Material Reservation, and State Machine Tracking
          </p>
        </div>
        <div className="erp-page-actions">
          <button type="button" className="erp-btn-outline" onClick={handleExportOrders} title="Export orders table to CSV">
            <Download size={16} />
            <span>Export Orders</span>
          </button>
          <button type="button" className="erp-btn-primary" onClick={handleOpenNewModal}>
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
              type="button"
              className={`erp-filter-chip ${activeFilter === filter ? 'active' : ''}`}
              onClick={() => {
                setActiveFilter(filter);
                setCurrentPage(1);
              }}
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
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
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

      {/* Orders Table */}
      <div className="erp-card">
        <div className="erp-table-wrapper">
          <table className="erp-data-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('id')} style={{ cursor: 'pointer' }}>
                  <div className="th-sort-wrap">
                    Order ID <ArrowUpDown size={12} />
                  </div>
                </th>
                <th onClick={() => handleSort('customer')} style={{ cursor: 'pointer' }}>
                  <div className="th-sort-wrap">
                    Buyer <ArrowUpDown size={12} />
                  </div>
                </th>
                <th onClick={() => handleSort('fabric')} style={{ cursor: 'pointer' }}>
                  <div className="th-sort-wrap">
                    Fabric <ArrowUpDown size={12} />
                  </div>
                </th>
                <th onClick={() => handleSort('quantity')} style={{ cursor: 'pointer' }}>
                  <div className="th-sort-wrap">
                    Quantity <ArrowUpDown size={12} />
                  </div>
                </th>
                <th>Yarn Batch</th>
                <th>Allocated Loom</th>
                <th onClick={() => handleSort('deadline')} style={{ cursor: 'pointer' }}>
                  <div className="th-sort-wrap">
                    Deadline <ArrowUpDown size={12} />
                  </div>
                </th>
                <th onClick={() => handleSort('progress')} style={{ cursor: 'pointer' }}>
                  <div className="th-sort-wrap">
                    Progress <ArrowUpDown size={12} />
                  </div>
                </th>
                <th onClick={() => handleSort('status')} style={{ cursor: 'pointer' }}>
                  <div className="th-sort-wrap">
                    Status <ArrowUpDown size={12} />
                  </div>
                </th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ textAlign: 'center', padding: '36px 12px' }}>
                    <div className="table-empty-wrap">
                      <Package size={32} className="text-muted" style={{ marginBottom: 8 }} />
                      <div className="font-semibold">No Manufacturing Orders Found</div>
                      <div className="text-xs text-secondary" style={{ marginTop: 4 }}>
                        No orders match your filter &ldquo;{activeFilter}&rdquo; or search &ldquo;{searchTerm}&rdquo;.
                      </div>
                      <button
                        type="button"
                        className="erp-btn-sm erp-btn-outline"
                        style={{ marginTop: 12 }}
                        onClick={() => {
                          setActiveFilter('All');
                          setSearchTerm('');
                        }}
                      >
                        Reset Filters
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedOrders.map((order) => {
                  const deadlineDate = new Date(order.deadline);
                  const today = new Date();
                  const daysLeft = Math.ceil((deadlineDate - today) / (1000 * 60 * 60 * 24));
                  const isOverdue = daysLeft < 0 && order.status !== 'Dispatched' && order.status !== 'Cancelled';
                  const isUrgent = daysLeft <= 3 && daysLeft >= 0 && order.status !== 'Dispatched' && order.status !== 'Cancelled';
                  const isCancelled = order.status === 'Cancelled';

                  return (
                    <tr key={order.id} className={isCancelled ? 'row-cancelled' : ''}>
                      <td className="table-primary-cell font-mono">{order.id}</td>
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
                                order.status === 'Failed QC' ? 'error' : isCancelled ? 'neutral' : ''
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
                              : isCancelled
                              ? 'outline text-muted'
                              : 'outline'
                          }`}
                        >
                          {order.status === 'Failed QC' && (
                            <AlertCircle size={11} style={{ marginRight: 3 }} />
                          )}
                          {order.status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <button
                            type="button"
                            className="erp-btn-icon-sm"
                            onClick={() => setSelectedOrder(order)}
                            title="View Order Details & Timeline"
                          >
                            <ArrowRight size={14} />
                          </button>
                          {!isCancelled && order.status !== 'Dispatched' && (
                            <button
                              type="button"
                              className="erp-btn-icon-sm btn-icon-danger"
                              onClick={() => setOrderToCancel(order)}
                              title="Cancel Order"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer with Pagination */}
        {filtered.length > pageSize && (
          <div className="table-pagination-bar">
            <span className="pagination-info-text">
              Showing {(currentPage - 1) * pageSize + 1} to{' '}
              {Math.min(currentPage * pageSize, filtered.length)} of {filtered.length} orders
            </span>
            <div className="pagination-buttons">
              <button
                type="button"
                className="pagination-btn"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft size={14} />
                <span>Previous</span>
              </button>
              <span className="pagination-page-indicator">
                {currentPage} / {totalPages}
              </span>
              <button
                type="button"
                className="pagination-btn"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                <span>Next</span>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Dialog for Order Cancellation (Section 15) */}
      <ConfirmDialog
        isOpen={Boolean(orderToCancel)}
        title={`Cancel Manufacturing Order ${orderToCancel?.id}?`}
        message={`This will immediately stop planned production for ${orderToCancel?.customer} (${orderToCancel?.quantity?.toLocaleString()}m ${orderToCancel?.fabric}) on ${orderToCancel?.machine}.`}
        consequences="Reserved yarn stock will be unlocked and returned to the general warehouse inventory. This status cannot be reversed."
        confirmLabel="Cancel Order"
        cancelLabel="Keep Order"
        isDestructive={true}
        onConfirm={() => {
          if (orderToCancel) {
            cancelOrder(orderToCancel.id, 'Floor Manager cancellation via Manufacturing Orders list');
            setOrderToCancel(null);
          }
        }}
        onCancel={() => setOrderToCancel(null)}
      />

      {/* MODAL: New Manufacturing Order with Feasibility Validation */}
      {showNewModal && (
        <div className="erp-modal-overlay" onClick={() => setShowNewModal(false)}>
          <div className="erp-modal-box large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title">Create Manufacturing Order & Check Feasibility</h3>
                <p className="modal-subtitle">
                  Feasibility Check: Material reserve, machine capacity, duration buffer
                </p>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setShowNewModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit}>
              <div className="modal-body">
                <div className="erp-form-grid">
                  <div className="form-group">
                    <label className="erp-label">Customer / Buyer Enterprise <span className="field-required">*</span></label>
                    <input
                      type="text"
                      className="erp-input"
                      value={formData.customer}
                      onChange={(e) => handleFormChange('customer', e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="erp-label">Fabric Specification <span className="field-required">*</span></label>
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
                    <label className="erp-label">Production Quantity (Meters) <span className="field-required">*</span></label>
                    <input
                      type="number"
                      className="erp-input"
                      min="500"
                      step="500"
                      value={formData.quantity}
                      onChange={(e) => handleFormChange('quantity', Number(e.target.value))}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="erp-label">Delivery Deadline <span className="field-required">*</span></label>
                    <input
                      type="date"
                      className="erp-input"
                      value={formData.deadline}
                      onChange={(e) => handleFormChange('deadline', e.target.value)}
                      required
                    />
                  </div>

                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="erp-label">Target Work Center / Loom Allocation</label>
                    <input
                      type="text"
                      className="erp-input"
                      value={formData.machine}
                      onChange={(e) => handleFormChange('machine', e.target.value)}
                    />
                  </div>
                </div>

                {/* Feasibility Check Panel */}
                {feasibility && (
                  <div
                    className={`feasibility-result-panel ${
                      feasibility.isFeasible ? 'feasible' : 'not-feasible'
                    }`}
                    style={{ marginTop: 18 }}
                  >
                    <div className="feasibility-verdict-row">
                      <div className="feasibility-badge-wrap">
                        {feasibility.isFeasible ? (
                          <>
                            <CheckCircle2 size={20} className="feasibility-icon-success" />
                            <div>
                              <strong className="feasibility-verdict-text">
                                ORDER FEASIBLE (Confidence: {feasibility.score}%)
                              </strong>
                              <div className="text-xs text-secondary">
                                All yarn raw materials and loom capacity verified.
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <AlertCircle size={20} className="feasibility-icon-error" />
                            <div>
                              <strong className="feasibility-verdict-text error">
                                MATERIAL / TIMELINE BOTTLENECK (Score: {feasibility.score}%)
                              </strong>
                              <div className="text-xs text-secondary">
                                Constraints exceeded. Admin approval required.
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
                        <span className="text-xs">{feasibility.yarnName}</span>
                      </div>
                      <div className="feasibility-metric-box">
                        <span className="text-xs text-secondary">Available Stock</span>
                        <strong>{feasibility.availableYarn.toLocaleString()} kg</strong>
                        <span className="text-xs">warehouse buffer</span>
                      </div>
                      <div className="feasibility-metric-box">
                        <span className="text-xs text-secondary">Production Days</span>
                        <strong>{feasibility.productionDaysNeeded} days</strong>
                        <span className="text-xs">standard speed</span>
                      </div>
                      <div className="feasibility-metric-box">
                        <span className="text-xs text-secondary">Time Buffer</span>
                        <strong>{feasibility.deadlineDays} days</strong>
                        <span className="text-xs">until delivery</span>
                      </div>
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
                >
                  Confirm Order & Reserve Yarn Stock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DRAWER / MODAL: Order Detail & State Machine Lifecycle */}
      {selectedOrder && (
        <div className="erp-modal-overlay" onClick={() => setSelectedOrder(null)}>
          <div className="erp-modal-box large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <h3 className="modal-title font-mono">{selectedOrder.id} — Order Lifecycle</h3>
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
              <button type="button" className="modal-close-btn" onClick={() => setSelectedOrder(null)}>
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              {/* Buyer Facing Timeline */}
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

              {/* Cost & Profitability Analysis */}
              {selectedOrder.cost && (
                <div className="order-detail-section" style={{ marginTop: 20 }}>
                  <h4 className="detail-section-title">Cost & Margin Breakdown</h4>
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
                    <div className="cost-row total">
                      <span>Estimated Profit Margin</span>
                      <strong>
                        ₹{selectedOrder.cost.profit.toLocaleString()} ({selectedOrder.cost.margin}% margin)
                      </strong>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <div>
                {selectedOrder.status !== 'Cancelled' && selectedOrder.status !== 'Dispatched' && (
                  <button
                    type="button"
                    className="erp-btn-sm erp-btn-outline text-red"
                    onClick={() => {
                      setOrderToCancel(selectedOrder);
                      setSelectedOrder(null);
                    }}
                  >
                    <Trash2 size={13} style={{ marginRight: 4 }} />
                    Cancel Order
                  </button>
                )}
              </div>
              <button type="button" className="erp-btn-outline" onClick={() => setSelectedOrder(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Destructive Action Confirm Dialog (Section 15) */}
      <ConfirmDialog
        isOpen={Boolean(orderToCancel)}
        title="Cancel Manufacturing Order?"
        message={`Are you sure you want to cancel order ${orderToCancel?.id} for ${orderToCancel?.customer}?`}
        consequences="Cancelling this order will immediately halt active weaving looms, release all reserved yarn batches back to available inventory, and log a permanent audit incident."
        confirmLabel="Cancel Order"
        cancelLabel="Keep Order Active"
        isDestructive={true}
        onConfirm={() => {
          if (orderToCancel) {
            cancelOrder(orderToCancel.id);
            setOrderToCancel(null);
          }
        }}
        onCancel={() => setOrderToCancel(null)}
      />
    </div>
  );
}
