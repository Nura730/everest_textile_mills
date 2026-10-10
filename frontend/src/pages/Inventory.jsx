import { useState } from 'react';
import { Package, Search, Plus, AlertTriangle, Download, ArrowUpDown } from 'lucide-react';
import { inventoryItems } from '../data/mockData';

const categoryFilters = ['All', 'Yarn', 'Fiber', 'Dye', 'Chemical', 'Parts'];

export default function Inventory() {
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = inventoryItems.filter(item => {
    const matchesFilter = activeFilter === 'All' || item.category === activeFilter;
    const matchesSearch = !searchTerm ||
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.id.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const shortageCount = inventoryItems.filter(i => i.shortage).length;

  return (
    <div>
      <div className="page-header">
        <div className="page-header-info">
          <h1>Inventory</h1>
          <p>Raw materials, dyes, chemicals, and spare parts</p>
        </div>
        <div className="page-header-actions">
          <button className="btn btn-secondary">
            <Download size={16} />
            Export
          </button>
          <button className="btn btn-primary">
            <Plus size={16} />
            Add Material
          </button>
        </div>
      </div>

      {/* Shortage Alert */}
      {shortageCount > 0 && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--color-error-light)',
          border: '1px solid var(--color-error-border)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 'var(--space-4)',
          fontSize: 'var(--font-size-base)',
        }}>
          <AlertTriangle size={16} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
          <span style={{ color: 'var(--color-error-dark)' }}>
            <strong>{shortageCount} material{shortageCount !== 1 ? 's' : ''}</strong> below minimum stock level. Immediate restocking required.
          </span>
        </div>
      )}

      {/* Summary */}
      <div className="grid-4" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="metric-card">
          <div className="metric-card-label">
            <Package size={16} />
            Total Items
          </div>
          <div className="metric-card-value">{inventoryItems.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-card-label">Categories</div>
          <div className="metric-card-value">{new Set(inventoryItems.map(i => i.category)).size}</div>
        </div>
        <div className={`metric-card ${shortageCount > 0 ? 'error' : ''}`}>
          <div className="metric-card-label">
            <AlertTriangle size={16} />
            Shortages
          </div>
          <div className="metric-card-value">{shortageCount}</div>
        </div>
        <div className="metric-card">
          <div className="metric-card-label">Locations</div>
          <div className="metric-card-value">{new Set(inventoryItems.map(i => i.location)).size}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="filter-bar">
        {categoryFilters.map(filter => (
          <button
            key={filter}
            className={`filter-chip ${activeFilter === filter ? 'active' : ''}`}
            onClick={() => setActiveFilter(filter)}
          >
            {filter}
          </button>
        ))}
        <div style={{ marginLeft: 'auto' }}>
          <div className="header-search" style={{ width: 220 }}>
            <Search size={16} />
            <input
              type="text"
              placeholder="Search materials..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Inventory Table */}
      <div className="card">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Material</th>
              <th>Category</th>
              <th>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                  Stock <ArrowUpDown size={12} />
                </span>
              </th>
              <th>Min Stock</th>
              <th>Location</th>
              <th>Last Restocked</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(item => {
              const stockPercentage = Math.round((item.stock / item.minStock) * 100);
              const isShortage = item.shortage;

              return (
                <tr key={item.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-500)' }}>
                    {item.id}
                  </td>
                  <td className="table-cell-primary">{item.name}</td>
                  <td><span className="badge badge-outline">{item.category}</span></td>
                  <td>
                    <span style={{ fontWeight: 600, color: isShortage ? 'var(--color-error)' : 'var(--color-gray-900)' }}>
                      {item.stock.toLocaleString()} {item.unit}
                    </span>
                  </td>
                  <td style={{ color: 'var(--color-gray-500)' }}>{item.minStock.toLocaleString()} {item.unit}</td>
                  <td style={{ color: 'var(--color-gray-500)' }}>{item.location}</td>
                  <td style={{ color: 'var(--color-gray-500)' }}>{item.lastRestocked}</td>
                  <td>
                    {isShortage ? (
                      <span className="badge badge-error">
                        <AlertTriangle size={11} />
                        Shortage
                      </span>
                    ) : (
                      <span className="badge badge-neutral">Adequate</span>
                    )}
                  </td>
                  <td>
                    {isShortage && (
                      <button className="btn btn-sm btn-primary">Reorder</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
