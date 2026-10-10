import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Zap,
  BarChart2,
  Plus,
  TrendingDown,
  TrendingUp,
  Minus,
  Clock,
  Target,
  FileText,
  ClipboardList,
  IndianRupee,
  ArrowRight,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  X,
  Sparkles,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useApp } from '../context/AppContext';
import { weeklyOutputData, machineUtilizationData, boms } from '../data/mockData';

export default function Dashboard() {
  const navigate = useNavigate();
  const {
    orders,
    machines,
    inventory,
    alerts,
    checkFeasibility,
    createOrder,
  } = useApp();

  const [currentTime, setCurrentTime] = useState('09:34:22');
  const [showNewMOModal, setShowNewMOModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState(null);

  // Form state for New MO
  const [formData, setFormData] = useState({
    customer: 'Raymond Ltd.',
    fabric: 'Cotton Twill 2/1',
    quantity: 5000,
    deadline: '2026-10-24',
    machine: 'Rapier Loom A-12',
  });

  // Compute live feasibility whenever form changes
  const feasibilityResult = useMemo(() => {
    if (!showNewMOModal) return null;
    return checkFeasibility(formData.fabric, formData.quantity, formData.deadline);
  }, [formData, showNewMOModal, checkFeasibility]);

  // Update clock
  useEffect(() => {
    const updateTime = () => {
      const d = new Date();
      setCurrentTime(d.toTimeString().split(' ')[0]);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const activeOrders = orders.filter((o) => o.status === 'In Production');
  const completedOrders = orders.filter((o) => o.status === 'Dispatched');
  const errorMachines = machines.filter((m) => m.error);
  const shortages = inventory.filter((i) => i.shortage);

  const handleCreateMOSubmit = (e) => {
    e.preventDefault();
    createOrder(formData);
    setShowNewMOModal(false);
  };

  return (
    <div className="erp-dashboard-container">
      {/* 1. Page Header matching Reference Screenshot */}
      <div className="erp-page-header">
        <div className="erp-page-header-text">
          <h1 className="erp-page-title">Manufacturing Dashboard</h1>
          <p className="erp-page-subtitle">Real-time insights into your manufacturing operations</p>
        </div>
        <div className="erp-page-actions">
          <button className="erp-btn-outline" onClick={() => navigate('/reports')}>
            <BarChart2 size={16} />
            <span>View Reports</span>
          </button>
          <button className="erp-btn-outline" onClick={() => setShowNewMOModal(true)}>
            <Plus size={16} />
            <span>New MO</span>
          </button>
        </div>
      </div>

      {/* Critical Alert Banner if error machines or QC failures exist */}
      {(errorMachines.length > 0 || shortages.length > 0) && (
        <div className="erp-alert-box">
          <div className="erp-alert-icon">
            <ShieldAlert size={20} />
          </div>
          <div className="erp-alert-content">
            <div className="erp-alert-title">
              Operational Attention Required: {errorMachines.length} Machine Alert, {shortages.length} Material Deficits
            </div>
            <div className="erp-alert-desc">
              {errorMachines.length > 0 && `• ${errorMachines[0].name}: ${errorMachines[0].status}. `}
              {shortages.length > 0 && `• Raw material ${shortages[0].name} has fallen below safe inventory buffer.`}
            </div>
          </div>
          <button className="erp-alert-action-btn" onClick={() => navigate('/machines')}>
            Resolve in Work Centers
          </button>
        </div>
      )}

      {/* 2. Live Metrics Card Container — EXACT layout from reference screenshot */}
      <div className="erp-card live-metrics-container">
        <div className="live-metrics-header">
          <div className="live-metrics-title-row">
            <Zap size={18} className="live-metrics-zap-icon" />
            <span className="live-metrics-title">Live Metrics</span>
          </div>
          <span className="live-metrics-subtitle">
            Real-time performance indicators • Last updated: {currentTime}
          </span>
        </div>

        <div className="live-metrics-grid">
          {/* Metric 1: Overall Efficiency */}
          <div className="live-metric-card">
            <div className="live-metric-header">
              <span className="live-metric-label">Overall Efficiency</span>
              <Minus size={16} className="text-secondary" />
            </div>
            <div className="live-metric-value-row">
              <span className="live-metric-value">87.5%</span>
            </div>
          </div>

          {/* Metric 2: Hourly Throughput (with -5.3% RED badge) */}
          <div className="live-metric-card">
            <div className="live-metric-header">
              <span className="live-metric-label">Hourly Throughput</span>
              <TrendingDown size={16} style={{ color: 'var(--color-error)' }} />
            </div>
            <div className="live-metric-value-row">
              <span className="live-metric-value">42.6</span>
              <span className="live-metric-unit">units</span>
              <span className="live-metric-badge error">
                <TrendingDown size={11} style={{ marginRight: 2 }} />
                -5.3%
              </span>
            </div>
          </div>

          {/* Metric 3: Quality Score */}
          <div className="live-metric-card">
            <div className="live-metric-header">
              <span className="live-metric-label">Quality Score</span>
              <TrendingUp size={16} className="text-secondary" />
            </div>
            <div className="live-metric-value-row">
              <span className="live-metric-value">97.9%</span>
              <span className="live-metric-badge neutral">
                <TrendingUp size={11} style={{ marginRight: 2 }} />
                +1.4%
              </span>
            </div>
          </div>

          {/* Metric 4: Equipment Utilization */}
          <div className="live-metric-card">
            <div className="live-metric-header">
              <span className="live-metric-label">Equipment Utilization</span>
              <TrendingUp size={16} className="text-secondary" />
            </div>
            <div className="live-metric-value-row">
              <span className="live-metric-value">79.6%</span>
              <span className="live-metric-badge neutral">
                <TrendingUp size={11} style={{ marginRight: 2 }} />
                +2%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Row 2: Tall Rounded Metric Cards — EXACT layout from reference screenshot */}
      <div className="erp-tall-kpi-grid">
        {/* Manufacturing Orders */}
        <div className="erp-tall-kpi-card" onClick={() => navigate('/orders')}>
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Manufacturing Orders</span>
            <FileText size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">{orders.length}</div>
          <div className="tall-kpi-subtext">
            {activeOrders.length} active, {completedOrders.length} completed
          </div>
        </div>

        {/* Work Orders */}
        <div className="erp-tall-kpi-card" onClick={() => navigate('/production')}>
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Work Orders</span>
            <ClipboardList size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">14</div>
          <div className="tall-kpi-subtext">9 active, 5 completed</div>
        </div>

        {/* Efficiency */}
        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Efficiency</span>
            <Target size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">87.5%</div>
          <div className="tall-kpi-change">+2.1% from last month</div>
        </div>

        {/* On-Time Delivery */}
        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">On-Time Delivery</span>
            <Clock size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">94.2%</div>
          <div className="tall-kpi-change">+1.5% from last month</div>
        </div>

        {/* Revenue */}
        <div className="erp-tall-kpi-card" onClick={() => navigate('/reports')}>
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Revenue</span>
            <IndianRupee size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">₹1.84M</div>
          <div className="tall-kpi-change">+8.2% from last month</div>
        </div>

        {/* Quality Score */}
        <div className="erp-tall-kpi-card" onClick={() => navigate('/quality')}>
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Quality Score</span>
            <Zap size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">97.9%</div>
          <div className="tall-kpi-change">+0.8% from last month</div>
        </div>
      </div>

      {/* 4. Intelligence Layer & Risk Recommendation Panel (Section 9 of Requirements) */}
      {alerts.length > 0 && (
        <div className="erp-intelligence-panel">
          <div className="intelligence-panel-header">
            <div className="intelligence-panel-badge">
              <Sparkles size={14} />
              <span>Manufacturing Intelligence Engine</span>
            </div>
            <span className="text-xs text-secondary">
              Predictive risk assessment active
            </span>
          </div>
          <div className="intelligence-alerts-grid">
            {alerts.map((al) => (
              <div key={al.id} className="intelligence-card">
                <div className="intelligence-card-top">
                  <span className="intelligence-risk-tag">{al.level}</span>
                  <span className="text-xs text-secondary">{al.timestamp}</span>
                </div>
                <div className="intelligence-title">{al.title}</div>
                <div className="intelligence-reason">
                  <strong>Risk Root Cause:</strong> {al.reason}
                </div>
                <div className="intelligence-rec-box">
                  <strong>Recommendation:</strong> {al.recommendation}
                </div>
                <div className="intelligence-action-row">
                  <button
                    className="erp-btn-sm erp-btn-dark"
                    onClick={() => navigate('/machines')}
                  >
                    {al.actionRequired}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Production Output & Machine Fleet Utilization Charts (Monochrome) */}
      <div className="erp-charts-grid">
        <div className="erp-card">
          <div className="card-header">
            <div>
              <div className="card-title">Weekly Fabric Output</div>
              <div className="card-subtitle">Meters woven across all operating loom sheds</div>
            </div>
            <span className="card-metric-tag">31,210 m total</span>
          </div>
          <div style={{ height: 240, width: '100%', marginTop: 12 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyOutputData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
                <XAxis dataKey="day" stroke="#737373" fontSize={12} tickLine={false} />
                <YAxis stroke="#737373" fontSize={12} tickLine={false} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="erp-chart-tooltip">
                          <div style={{ fontWeight: 600 }}>{label}</div>
                          <div>{payload[0].value.toLocaleString()} meters woven</div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="output" fill="#171717" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="erp-card">
          <div className="card-header">
            <div>
              <div className="card-title">Loom Shed Utilization</div>
              <div className="card-subtitle">Active running time vs planned capacity</div>
            </div>
            <span className="card-metric-tag">Average: 92.4%</span>
          </div>
          <div style={{ height: 240, width: '100%', marginTop: 12 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={machineUtilizationData}
                layout="vertical"
                margin={{ top: 5, right: 20, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} stroke="#737373" fontSize={11} unit="%" />
                <YAxis type="category" dataKey="name" stroke="#737373" fontSize={11} width={80} tickLine={false} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="erp-chart-tooltip">
                          <div>{payload[0].payload.name}</div>
                          <div style={{ fontWeight: 600 }}>{payload[0].value}% Uptime</div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar
                  dataKey="utilization"
                  fill="#525252"
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 6. Active Manufacturing Orders Table */}
      <div className="erp-card" style={{ marginTop: 24 }}>
        <div className="card-header">
          <div>
            <div className="card-title">Active Manufacturing Orders</div>
            <div className="card-subtitle">
              Orders progressing through spinning, weaving, and inspection
            </div>
          </div>
          <button className="erp-btn-sm erp-btn-outline" onClick={() => navigate('/orders')}>
            View All Orders
            <ArrowRight size={13} style={{ marginLeft: 4 }} />
          </button>
        </div>

        <div className="erp-table-wrapper">
          <table className="erp-data-table">
            <thead>
              <tr>
                <th>Order ID</th>
                <th>Buyer</th>
                <th>Fabric Specification</th>
                <th>Quantity</th>
                <th>Allocated Machine</th>
                <th>Deadline</th>
                <th>Progress</th>
                <th>State</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 6).map((order) => (
                <tr key={order.id}>
                  <td className="table-primary-cell">{order.id}</td>
                  <td>{order.customer}</td>
                  <td>{order.fabric}</td>
                  <td>{order.quantity.toLocaleString()} {order.unit}</td>
                  <td>
                    <span className="text-secondary">{order.machine}</span>
                  </td>
                  <td>{order.deadline}</td>
                  <td style={{ minWidth: 120 }}>
                    <div className="table-progress-wrap">
                      <div className="erp-progress-bar">
                        <div
                          className={`erp-progress-fill ${order.status === 'Failed QC' ? 'error' : ''}`}
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
                      {order.status === 'Failed QC' && <ShieldAlert size={12} style={{ marginRight: 3 }} />}
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
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: New Manufacturing Order with Live Feasibility Calculation (Section 5) */}
      {showNewMOModal && (
        <div className="erp-modal-overlay">
          <div className="erp-modal-box large">
            <div className="modal-header">
              <div>
                <h3 className="modal-title">Create Manufacturing Order & Feasibility Check</h3>
                <p className="modal-subtitle">
                  Everest Textile Mills — Section 5 Manufacturing State Machine Validation
                </p>
              </div>
              <button className="modal-close-btn" onClick={() => setShowNewMOModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateMOSubmit}>
              <div className="modal-body">
                <div className="erp-form-grid">
                  <div className="form-group">
                    <label className="erp-label">Buyer / Client</label>
                    <input
                      type="text"
                      className="erp-input"
                      value={formData.customer}
                      onChange={(e) => setFormData({ ...formData, customer: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="erp-label">Fabric Variety / BOM</label>
                    <select
                      className="erp-select"
                      value={formData.fabric}
                      onChange={(e) => setFormData({ ...formData, fabric: e.target.value })}
                    >
                      {boms.map((b) => (
                        <option key={b.id} value={b.fabric}>
                          {b.fabric} ({b.yarn})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="erp-label">Production Quantity (Meters)</label>
                    <input
                      type="number"
                      className="erp-input"
                      min="500"
                      step="500"
                      value={formData.quantity}
                      onChange={(e) => setFormData({ ...formData, quantity: Number(e.target.value) })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="erp-label">Delivery Deadline</label>
                    <input
                      type="date"
                      className="erp-input"
                      value={formData.deadline}
                      onChange={(e) => setFormData({ ...formData, deadline: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="erp-label">Target Work Center / Loom Allocation</label>
                    <select
                      className="erp-select"
                      value={formData.machine}
                      onChange={(e) => setFormData({ ...formData, machine: e.target.value })}
                    >
                      {machines.map((m) => (
                        <option key={m.id} value={m.name} disabled={m.error}>
                          {m.name} — Status: {m.status} {m.error ? '(HALTED)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Live Feasibility Engine Output */}
                {feasibilityResult && (
                  <div
                    className={`feasibility-result-panel ${
                      feasibilityResult.isFeasible ? 'feasible' : 'not-feasible'
                    }`}
                  >
                    <div className="feasibility-verdict-row">
                      <div className="feasibility-badge-wrap">
                        {feasibilityResult.isFeasible ? (
                          <>
                            <CheckCircle2 size={20} className="feasibility-icon-success" />
                            <div>
                              <strong className="feasibility-verdict-text">
                                ORDER FEASIBLE (Score: {feasibilityResult.score}%)
                              </strong>
                              <div className="text-xs text-secondary">
                                All factory constraints satisfied for production commitment.
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <XCircle size={20} className="feasibility-icon-error" />
                            <div>
                              <strong className="feasibility-verdict-text error">
                                HIGH RISK / NOT FEASIBLE (Score: {feasibilityResult.score}%)
                              </strong>
                              <div className="text-xs text-secondary">
                                Critical production constraints violated. See explainable audit below.
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="feasibility-metrics-summary">
                      <div className="feasibility-metric-box">
                        <span className="text-xs text-secondary">Required Yarn</span>
                        <strong>{feasibilityResult.requiredYarnKg.toLocaleString()} kg</strong>
                        <span className="text-xs">{feasibilityResult.yarnName}</span>
                      </div>
                      <div className="feasibility-metric-box">
                        <span className="text-xs text-secondary">Available Stock</span>
                        <strong
                          style={
                            feasibilityResult.availableYarn < feasibilityResult.requiredYarnKg
                              ? { color: 'var(--color-error)' }
                              : {}
                          }
                        >
                          {feasibilityResult.availableYarn.toLocaleString()} kg
                        </strong>
                        <span className="text-xs">unreserved in store</span>
                      </div>
                      <div className="feasibility-metric-box">
                        <span className="text-xs text-secondary">Duration Required</span>
                        <strong>{feasibilityResult.productionDaysNeeded} days</strong>
                        <span className="text-xs">@ 800m standard/day</span>
                      </div>
                      <div className="feasibility-metric-box">
                        <span className="text-xs text-secondary">Time Buffer</span>
                        <strong
                          style={
                            feasibilityResult.deadlineDays < feasibilityResult.productionDaysNeeded
                              ? { color: 'var(--color-error)' }
                              : {}
                          }
                        >
                          {feasibilityResult.deadlineDays} days
                        </strong>
                        <span className="text-xs">until delivery date</span>
                      </div>
                    </div>

                    <div className="feasibility-reasons-list">
                      {feasibilityResult.reasons.map((r, i) => (
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
                  onClick={() => setShowNewMOModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="erp-btn-primary"
                  disabled={!feasibilityResult?.isFeasible}
                >
                  {feasibilityResult?.isFeasible
                    ? 'Confirm Order & Reserve Yarn Stock'
                    : 'Override Feasibility Warning (Admin Only)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DRAWER / MODAL: Order Detail & State Machine Lifecycle (Section 4 & 19) */}
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
              <button
                className="erp-btn-primary"
                onClick={() => {
                  setSelectedOrder(null);
                  navigate('/orders');
                }}
              >
                Go to Order Management
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
