import { useState } from 'react';
import { Truck, Package, MapPin, Calendar, Search, Plus, ArrowRight } from 'lucide-react';
import { dispatches } from '../data/mockData';

const statusFilters = ['All', 'Not Started', 'Awaiting QC', 'Packing', 'Shipped'];

export default function Dispatch() {
  const [activeFilter, setActiveFilter] = useState('All');

  const filtered = dispatches.filter(d => {
    if (activeFilter === 'All') return true;
    return d.status === activeFilter;
  });

  return (
    <div>
      <div className="page-header">
        <div className="page-header-info">
          <h1>Dispatch</h1>
          <p>Shipment scheduling, packing, and delivery tracking</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-primary">
            <Plus size={16} />
            Schedule Dispatch
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid-4" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="metric-card">
          <div className="metric-card-label">
            <Truck size={16} />
            Total Dispatches
          </div>
          <div className="metric-card-value">{dispatches.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-card-label">Shipped</div>
          <div className="metric-card-value">{dispatches.filter(d => d.status === 'Shipped').length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-card-label">In Progress</div>
          <div className="metric-card-value">{dispatches.filter(d => ['Packing', 'Awaiting QC'].includes(d.status)).length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-card-label">Not Started</div>
          <div className="metric-card-value">{dispatches.filter(d => d.status === 'Not Started').length}</div>
        </div>
      </div>

      {/* Filter */}
      <div className="filter-bar">
        {statusFilters.map(filter => (
          <button
            key={filter}
            className={`filter-chip ${activeFilter === filter ? 'active' : ''}`}
            onClick={() => setActiveFilter(filter)}
          >
            {filter}
          </button>
        ))}
      </div>

      {/* Dispatch Table */}
      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Dispatch ID</th>
              <th>Order</th>
              <th>Customer</th>
              <th>Fabric</th>
              <th>Quantity</th>
              <th>Vehicle</th>
              <th>Dispatch Date</th>
              <th>ETA</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(dispatch => (
              <tr key={dispatch.id}>
                <td className="table-cell-primary">{dispatch.id}</td>
                <td>{dispatch.order}</td>
                <td>{dispatch.customer}</td>
                <td>{dispatch.fabric}</td>
                <td>{dispatch.quantity}</td>
                <td style={{ fontFamily: dispatch.vehicle !== '—' ? 'monospace' : 'inherit', fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-500)' }}>
                  {dispatch.vehicle}
                </td>
                <td style={{ color: 'var(--color-gray-500)' }}>{dispatch.dispatchDate}</td>
                <td style={{ color: 'var(--color-gray-500)' }}>{dispatch.eta}</td>
                <td>
                  <span className={`badge ${
                    dispatch.status === 'Shipped' ? 'badge-dark' :
                    dispatch.status === 'Packing' ? 'badge-neutral' :
                    'badge-outline'
                  }`}>
                    {dispatch.status}
                  </span>
                </td>
                <td>
                  <button className="btn btn-ghost btn-sm">
                    <ArrowRight size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="empty-state">
            <Truck size={32} />
            <div className="empty-state-title">No dispatches found</div>
            <div className="empty-state-text">Try adjusting your filter.</div>
          </div>
        )}
      </div>

      {/* Shipment Timeline */}
      <div className="card" style={{ marginTop: 'var(--space-4)' }}>
        <div className="card-header">
          <div>
            <div className="card-title">Dispatch Pipeline</div>
            <div className="card-subtitle">Order flow from production to delivery</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-4)', overflowX: 'auto', paddingBottom: 'var(--space-2)' }}>
          {['Awaiting QC', 'Packing', 'Ready to Ship', 'In Transit', 'Delivered'].map((stage, index) => {
            const count = stage === 'Ready to Ship'
              ? 0
              : stage === 'In Transit'
              ? dispatches.filter(d => d.status === 'Shipped').length
              : stage === 'Delivered'
              ? 0
              : dispatches.filter(d => d.status === stage).length;

            return (
              <div key={stage} style={{
                flex: '1 0 160px',
                padding: 'var(--space-4)',
                background: 'var(--color-gray-50)',
                borderRadius: 'var(--radius-md)',
                border: 'var(--border-light)',
                textAlign: 'center',
                position: 'relative',
              }}>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-gray-400)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--space-2)' }}>
                  Stage {index + 1}
                </div>
                <div style={{ fontWeight: 600, color: 'var(--color-gray-900)', marginBottom: 'var(--space-1)' }}>
                  {stage}
                </div>
                <div style={{ fontSize: 'var(--font-size-3xl)', fontWeight: 700, color: 'var(--color-black)' }}>
                  {count}
                </div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-gray-400)' }}>
                  order{count !== 1 ? 's' : ''}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
