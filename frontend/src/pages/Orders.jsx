import { useState } from 'react';
import { Plus, Search, Filter, Download, ArrowRight, Calendar, AlertCircle } from 'lucide-react';
import { orders } from '../data/mockData';

const statusFilters = ['All', 'Pending', 'In Production', 'Quality Check', 'Dispatched', 'Failed QC'];

export default function Orders() {
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = orders.filter(order => {
    const matchesFilter = activeFilter === 'All' || order.status === activeFilter;
    const matchesSearch = !searchTerm ||
      order.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.customer.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.fabric.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  return (
    <div>
      <div className="page-header">
        <div className="page-header-info">
          <h1>Orders</h1>
          <p>Manage customer orders and track fulfillment</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary">
            <Download size={16} />
            Export
          </button>
          <button className="btn btn-primary">
            <Plus size={16} />
            New Order
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar">
        {statusFilters.map(filter => (
          <button
            key={filter}
            className={`filter-chip ${activeFilter === filter ? 'active' : ''}`}
            onClick={() => setActiveFilter(filter)}
          >
            {filter}
            {filter === 'Failed QC' && orders.filter(o => o.status === 'Failed QC').length > 0 && (
              <AlertCircle size={12} style={{ color: activeFilter === 'Failed QC' ? '#fff' : 'var(--color-error)' }} />
            )}
          </button>
        ))}
        <div style={{ marginLeft: 'auto' }}>
          <div className="header-search" style={{ width: 220 }}>
            <Search size={16} />
            <input
              type="text"
              placeholder="Search orders..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Orders Table */}
      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>Order ID</th>
              <th>Customer</th>
              <th>Fabric</th>
              <th>Quantity</th>
              <th>Deadline</th>
              <th>Progress</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(order => {
              const deadlineDate = new Date(order.deadline);
              const today = new Date();
              const daysLeft = Math.ceil((deadlineDate - today) / (1000 * 60 * 60 * 24));
              const isOverdue = daysLeft < 0 && order.status !== 'Dispatched';
              const isUrgent = daysLeft <= 3 && daysLeft >= 0 && order.status !== 'Dispatched';

              return (
                <tr key={order.id}>
                  <td className="table-cell-primary">{order.id}</td>
                  <td>{order.customer}</td>
                  <td>{order.fabric}</td>
                  <td>{order.quantity}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Calendar size={13} style={{ color: 'var(--color-gray-400)' }} />
                      <span>{order.deadline}</span>
                      {isOverdue && (
                        <span className="badge badge-error">Overdue</span>
                      )}
                      {isUrgent && (
                        <span className="badge badge-outline" style={{ fontSize: 'var(--font-size-xs)' }}>
                          {daysLeft}d left
                        </span>
                      )}
                    </div>
                  </td>
                  <td style={{ minWidth: 130 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                    <span className={`badge ${
                      order.status === 'Failed QC' ? 'badge-error' :
                      order.status === 'In Production' ? 'badge-dark' :
                      order.status === 'Dispatched' ? 'badge-neutral' :
                      'badge-outline'
                    }`}>
                      {order.status === 'Failed QC' && <AlertCircle size={11} />}
                      {order.status}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm">
                      <ArrowRight size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="empty-state">
            <Search size={32} />
            <div className="empty-state-title">No orders found</div>
            <div className="empty-state-text">Try adjusting your search or filter criteria.</div>
          </div>
        )}
      </div>
    </div>
  );
}
