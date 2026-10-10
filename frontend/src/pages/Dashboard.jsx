import {
  ShoppingCart,
  Factory,
  Gauge,
  Truck,
  AlertTriangle,
  CheckSquare,
  Ruler,
  DollarSign,
  ArrowRight,
  Package,
  Cog,
  TrendingDown,
  Clock,
  AlertCircle,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, Cell,
} from 'recharts';
import {
  dashboardKPIs,
  weeklyOutputData,
  machineUtilizationData,
  recentActivity,
  orders,
  machines,
  inventoryItems,
  costBreakdown,
} from '../data/mockData';

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        background: '#171717',
        color: '#fff',
        padding: '8px 12px',
        borderRadius: '6px',
        fontSize: '12px',
        lineHeight: '1.4',
        border: 'none',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div style={{ color: '#a3a3a3' }}>{payload[0].value.toLocaleString()} m</div>
      </div>
    );
  }
  return null;
};

const UtilTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        background: '#171717',
        color: '#fff',
        padding: '8px 12px',
        borderRadius: '6px',
        fontSize: '12px',
        border: 'none',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      }}>
        <div style={{ fontWeight: 600 }}>{label}</div>
        <div style={{ color: '#a3a3a3' }}>{payload[0].value}% uptime</div>
      </div>
    );
  }
  return null;
};

export default function Dashboard() {
  const shortages = inventoryItems.filter(i => i.shortage);
  const errorMachines = machines.filter(m => m.error);
  const urgentOrders = orders.filter(o => o.status === 'Failed QC');

  return (
    <div>
      {/* Page Header */}
      <div className="page-header">
        <div className="page-header-info">
          <h1>Dashboard</h1>
          <p>Everest Textile Mills — Production overview for {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary">
            <Clock size={16} />
            Last 7 days
          </button>
          <button className="btn btn-primary">
            <Factory size={16} />
            New Production Run
          </button>
        </div>
      </div>

      {/* Critical Alerts - only shown when errors exist */}
      {(errorMachines.length > 0 || urgentOrders.length > 0) && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          {errorMachines.map(m => (
            <div key={m.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--color-error-light)',
              border: '1px solid var(--color-error-border)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-2)',
              fontSize: 'var(--font-size-base)',
            }}>
              <AlertCircle size={16} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
              <span style={{ color: 'var(--color-error-dark)' }}>
                <strong>{m.name}</strong> — {m.status}. Maintenance required.
              </span>
              <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }}>View Machine</button>
            </div>
          ))}
          {urgentOrders.map(o => (
            <div key={o.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--color-error-light)',
              border: '1px solid var(--color-error-border)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-2)',
              fontSize: 'var(--font-size-base)',
            }}>
              <AlertCircle size={16} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
              <span style={{ color: 'var(--color-error-dark)' }}>
                Order <strong>{o.id}</strong> ({o.customer}) — QC Failure. Requires rework or review.
              </span>
              <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }}>View Order</button>
            </div>
          ))}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid-dashboard" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="metric-card">
          <div className="metric-card-label">
            <ShoppingCart size={16} />
            Total Orders
          </div>
          <div className="metric-card-value">{dashboardKPIs.totalOrders}</div>
          <div className="metric-card-change">This month</div>
        </div>

        <div className="metric-card">
          <div className="metric-card-label">
            <Factory size={16} />
            Active Production
          </div>
          <div className="metric-card-value">{dashboardKPIs.activeProduction}</div>
          <div className="metric-card-change">Running across all lines</div>
        </div>

        <div className="metric-card">
          <div className="metric-card-label">
            <Gauge size={16} />
            Machine Utilization
          </div>
          <div className="metric-card-value">{dashboardKPIs.machineUtilization}</div>
          <div className="metric-card-change">Average across fleet</div>
        </div>

        <div className={`metric-card ${shortages.length > 0 ? 'error' : ''}`}>
          <div className="metric-card-label">
            <AlertTriangle size={16} />
            Material Shortages
          </div>
          <div className="metric-card-value">{dashboardKPIs.materialShortages}</div>
          <div className="metric-card-change" style={shortages.length > 0 ? { color: 'var(--color-error)' } : {}}>
            {shortages.length > 0 ? 'Immediate restocking required' : 'All stocks adequate'}
          </div>
        </div>
      </div>

      {/* Second Row: Output + Utilization + Pending */}
      <div className="grid-dashboard" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="metric-card">
          <div className="metric-card-label">
            <Ruler size={16} />
            Daily Output
          </div>
          <div className="metric-card-value">{dashboardKPIs.dailyOutput}</div>
          <div className="metric-card-change">Meters produced today</div>
        </div>

        <div className="metric-card">
          <div className="metric-card-label">
            <CheckSquare size={16} />
            Quality Pass Rate
          </div>
          <div className="metric-card-value">{dashboardKPIs.qualityPassRate}</div>
          <div className="metric-card-change">Last 30 days average</div>
        </div>

        <div className="metric-card">
          <div className="metric-card-label">
            <Truck size={16} />
            Pending Dispatch
          </div>
          <div className="metric-card-value">{dashboardKPIs.pendingDispatch}</div>
          <div className="metric-card-change">Awaiting shipment</div>
        </div>

        <div className="metric-card">
          <div className="metric-card-label">
            <DollarSign size={16} />
            Cost Per Meter
          </div>
          <div className="metric-card-value">{dashboardKPIs.costPerMeter}</div>
          <div className="metric-card-change">Current production average</div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid-2" style={{ marginBottom: 'var(--space-4)' }}>
        {/* Weekly Output Chart */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Weekly Production Output</div>
              <div className="card-subtitle">Meters produced per day</div>
            </div>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyOutputData} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
                <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#737373', fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#737373', fontSize: 12 }} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f5f5f5' }} />
                <Bar dataKey="output" radius={[4, 4, 0, 0]}>
                  {weeklyOutputData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.output === 0 ? '#d4d4d4' : '#262626'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Machine Utilization Chart */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Machine Utilization</div>
              <div className="card-subtitle">Uptime percentage by machine</div>
            </div>
          </div>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={machineUtilizationData} layout="vertical" barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: '#737373', fontSize: 12 }} />
                <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#737373', fontSize: 11 }} width={90} />
                <Tooltip content={<UtilTooltip />} cursor={{ fill: '#f5f5f5' }} />
                <Bar dataKey="utilization" radius={[0, 4, 4, 0]}>
                  {machineUtilizationData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.utilization < 80 ? '#dc2626' : '#404040'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Bottom Row: Orders Progress + Activity + Cost */}
      <div className="grid-3" style={{ marginBottom: 'var(--space-4)' }}>
        {/* Active Orders */}
        <div className="card grid-span-2">
          <div className="card-header">
            <div>
              <div className="card-title">Active Orders</div>
              <div className="card-subtitle">Current production progress</div>
            </div>
            <button className="card-action">
              View All <ArrowRight size={14} />
            </button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Customer</th>
                <th>Fabric</th>
                <th>Progress</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.filter(o => o.status !== 'Dispatched').slice(0, 6).map(order => (
                <tr key={order.id}>
                  <td className="table-cell-primary">{order.id}</td>
                  <td>{order.customer}</td>
                  <td>{order.fabric}</td>
                  <td style={{ minWidth: 120 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div className="progress-bar" style={{ flex: 1 }}>
                        <div
                          className={`progress-bar-fill ${order.status === 'Failed QC' ? 'error' : ''}`}
                          style={{ width: `${order.progress}%` }}
                        />
                      </div>
                      <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-gray-500)', minWidth: 30 }}>
                        {order.progress}%
                      </span>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${order.status === 'Failed QC' ? 'badge-error' : order.status === 'In Production' ? 'badge-dark' : 'badge-neutral'}`}>
                      {order.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Cost Breakdown */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Cost Breakdown</div>
              <div className="card-subtitle">This month's production costs</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {costBreakdown.map(item => (
              <div key={item.category}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 'var(--font-size-sm)' }}>
                  <span style={{ color: 'var(--color-gray-700)', fontWeight: 500 }}>{item.category}</span>
                  <span style={{ color: 'var(--color-gray-500)' }}>₹{(item.amount / 1000).toFixed(0)}K ({item.percentage}%)</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-bar-fill" style={{ width: `${item.percentage}%` }} />
                </div>
              </div>
            ))}
            <hr className="divider" />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-md)', fontWeight: 600 }}>
              <span>Total</span>
              <span>₹14.25L</span>
            </div>
          </div>
        </div>
      </div>

      {/* Activity + Shortages Row */}
      <div className="grid-2">
        {/* Recent Activity */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Recent Activity</div>
              <div className="card-subtitle">Latest updates across the mill</div>
            </div>
          </div>
          <div>
            {recentActivity.slice(0, 6).map((item, index) => (
              <div className="activity-item" key={index}>
                <div className={`activity-icon ${item.error ? 'error' : ''}`}>
                  {item.type === 'production' && <Factory size={14} />}
                  {item.type === 'quality' && <CheckSquare size={14} />}
                  {item.type === 'inventory' && <Package size={14} />}
                  {item.type === 'dispatch' && <Truck size={14} />}
                  {item.type === 'machine' && <Cog size={14} />}
                  {item.type === 'order' && <ShoppingCart size={14} />}
                </div>
                <div className="activity-content">
                  <div className="activity-text">{item.text}</div>
                  <div className="activity-time">{item.time}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Material Shortages */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">Material Shortages</div>
              <div className="card-subtitle">Items below minimum stock level</div>
            </div>
            <button className="card-action">
              Inventory <ArrowRight size={14} />
            </button>
          </div>
          {shortages.length > 0 ? (
            <div>
              {shortages.map(item => (
                <div key={item.id} style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-3) 0',
                  borderBottom: 'var(--border-light)',
                }}>
                  <div className="activity-icon error">
                    <AlertTriangle size={14} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, fontSize: 'var(--font-size-base)', color: 'var(--color-gray-900)' }}>
                      {item.name}
                    </div>
                    <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-error)', marginTop: 2 }}>
                      Stock: {item.stock} {item.unit} — Minimum: {item.minStock} {item.unit}
                    </div>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-gray-400)', marginTop: 2 }}>
                      Last restocked: {item.lastRestocked}
                    </div>
                  </div>
                  <button className="btn btn-sm btn-primary">Reorder</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <Package size={32} />
              <div className="empty-state-title">All stocks adequate</div>
              <div className="empty-state-text">No materials are below minimum stock levels.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
