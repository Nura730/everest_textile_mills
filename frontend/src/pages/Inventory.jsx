import { useState } from 'react';
import { Package, Search, Plus, AlertTriangle, Download, ArrowUpDown, BookmarkPlus, X, CheckCircle2 } from 'lucide-react';
import { useApp } from '../context/AppContext';

const categoryFilters = ['All', 'Yarn', 'Fiber', 'Dye', 'Chemical', 'Parts'];

export default function Inventory() {
  const { inventory, reserveYarn, orders } = useApp();
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [reservingItem, setReservingItem] = useState(null);
  const [reserveAmount, setReserveAmount] = useState(250);
  const [reserveOrderId, setReserveOrderId] = useState(orders[0]?.id || 'ORD-2410-001');

  const filtered = inventory.filter((item) => {
    const matchesFilter = activeFilter === 'All' || item.category === activeFilter;
    const matchesSearch =
      !searchTerm ||
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.color.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.supplier.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const shortageCount = inventory.filter((i) => i.shortage).length;

  const handleReserveSubmit = (e) => {
    e.preventDefault();
    if (reservingItem) {
      reserveYarn(reservingItem.id, reserveAmount, reserveOrderId);
      setReservingItem(null);
    }
  };

  return (
    <div className="erp-page-container">
      <div className="erp-page-header">
        <div className="erp-page-header-text">
          <h1 className="erp-page-title">Raw Material Inventory</h1>
          <p className="erp-page-subtitle">
            Section 6: Yarn Lot Tracking, E-Commerce Style Reservation, Available vs Reserved Stock
          </p>
        </div>
        <div className="erp-page-actions">
          <button className="erp-btn-outline">
            <Download size={16} />
            <span>Export Stock</span>
          </button>
        </div>
      </div>

      {/* Shortage Alert */}
      {shortageCount > 0 && (
        <div className="erp-alert-box">
          <div className="erp-alert-icon">
            <AlertTriangle size={20} />
          </div>
          <div className="erp-alert-content">
            <div className="erp-alert-title">
              Critical Inventory Buffer Deficit: {shortageCount} Materials Under Threshold
            </div>
            <div className="erp-alert-desc">
              Viscose Staple Fiber, Reactive Black Dye, and Bamboo Viscose Yarn have fallen below safety limits.
            </div>
          </div>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="erp-tall-kpi-grid" style={{ marginBottom: 20 }}>
        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Material Catalog</span>
            <Package size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">{inventory.length}</div>
          <div className="tall-kpi-subtext">Active SKUs & Batches</div>
        </div>

        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Yarn Stock (Total)</span>
            <Package size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">16,375 kg</div>
          <div className="tall-kpi-subtext">Cumulative physical yarn</div>
        </div>

        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Reserved for Orders</span>
            <BookmarkPlus size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">11,106 kg</div>
          <div className="tall-kpi-subtext">Committed to active orders</div>
        </div>

        <div className={`erp-tall-kpi-card ${shortageCount > 0 ? 'error' : ''}`}>
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Buffer Shortages</span>
            <AlertTriangle size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value" style={shortageCount > 0 ? { color: 'var(--color-error)' } : {}}>
            {shortageCount}
          </div>
          <div className="tall-kpi-subtext" style={shortageCount > 0 ? { color: 'var(--color-error)' } : {}}>
            Reorder PO required
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="erp-filter-bar">
        <div className="filter-chips-row">
          {categoryFilters.map((filter) => (
            <button
              key={filter}
              className={`erp-filter-chip ${activeFilter === filter ? 'active' : ''}`}
              onClick={() => setActiveFilter(filter)}
            >
              {filter}
            </button>
          ))}
        </div>
        <div className="erp-search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search material, yarn, supplier, lot..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      <div className="erp-card">
        <div className="erp-table-wrapper">
          <table className="erp-data-table">
            <thead>
              <tr>
                <th>Item ID</th>
                <th>Material Specification</th>
                <th>Category</th>
                <th>Color / Shade</th>
                <th>Total Physical</th>
                <th>Reserved Stock</th>
                <th>Available Stock</th>
                <th>Supplier & Lot</th>
                <th>Storage Bin</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td className="table-primary-cell">{item.id}</td>
                  <td>
                    <div>
                      <strong>{item.name}</strong>
                      <div className="text-xs text-secondary">
                        Min Buffer: {item.minStock.toLocaleString()} {item.unit}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="erp-status-badge outline">{item.category}</span>
                  </td>
                  <td>{item.color}</td>
                  <td>
                    {item.totalStock.toLocaleString()} {item.unit}
                  </td>
                  <td>
                    <span style={{ color: 'var(--color-gray-700)', fontWeight: 500 }}>
                      {item.reservedStock.toLocaleString()} {item.unit}
                    </span>
                  </td>
                  <td>
                    <span
                      style={{
                        fontWeight: 600,
                        color: item.shortage ? 'var(--color-error)' : 'var(--color-black)',
                      }}
                    >
                      {item.availableStock.toLocaleString()} {item.unit}
                    </span>
                    {item.shortage && (
                      <span className="erp-status-badge error" style={{ marginLeft: 6, fontSize: 10 }}>
                        Shortage
                      </span>
                    )}
                  </td>
                  <td>
                    <div>
                      <div style={{ fontSize: 12 }}>{item.supplier}</div>
                      <div className="text-xs text-secondary" style={{ fontFamily: 'monospace' }}>
                        {item.lotNumber}
                      </div>
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--color-gray-600)' }}>{item.location}</td>
                  <td>
                    {item.category === 'Yarn' && (
                      <button
                        className="erp-btn-sm erp-btn-outline"
                        onClick={() => {
                          setReservingItem(item);
                          setReserveAmount(Math.min(item.availableStock, 500));
                        }}
                        disabled={item.availableStock <= 0}
                      >
                        <BookmarkPlus size={13} />
                        <span>Reserve</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: E-Commerce Style Yarn Reservation (Store Keeper Section 2 & 6) */}
      {reservingItem && (
        <div className="erp-modal-overlay">
          <div className="erp-modal-box">
            <div className="modal-header">
              <div>
                <h3 className="modal-title">E-Commerce Material Selection & Reservation</h3>
                <p className="modal-subtitle">
                  Section 6: {reservingItem.name} ({reservingItem.color}) • Lot {reservingItem.lotNumber}
                </p>
              </div>
              <button className="modal-close-btn" onClick={() => setReservingItem(null)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleReserveSubmit}>
              <div className="modal-body">
                <div className="reservation-metric-banner">
                  <div className="reserve-stat">
                    <span className="text-xs text-secondary">Total Stock</span>
                    <strong>
                      {reservingItem.totalStock} {reservingItem.unit}
                    </strong>
                  </div>
                  <div className="reserve-stat">
                    <span className="text-xs text-secondary">Currently Reserved</span>
                    <strong>
                      {reservingItem.reservedStock} {reservingItem.unit}
                    </strong>
                  </div>
                  <div className="reserve-stat highlight">
                    <span className="text-xs text-secondary">Available Stock</span>
                    <strong style={{ fontSize: 18 }}>
                      {reservingItem.availableStock} {reservingItem.unit}
                    </strong>
                  </div>
                </div>

                <div className="erp-form-grid" style={{ marginTop: 16 }}>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="erp-label">Target Manufacturing Order</label>
                    <select
                      className="erp-select"
                      value={reserveOrderId}
                      onChange={(e) => setReserveOrderId(e.target.value)}
                    >
                      {orders.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.id} — {o.customer} ({o.quantity}m {o.fabric})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="erp-label">Reservation Quantity ({reservingItem.unit})</label>
                    <input
                      type="number"
                      className="erp-input"
                      min="10"
                      max={reservingItem.availableStock}
                      value={reserveAmount}
                      onChange={(e) => setReserveAmount(Number(e.target.value))}
                      required
                    />
                    <div className="text-xs text-secondary" style={{ marginTop: 4 }}>
                      Max available: {reservingItem.availableStock} {reservingItem.unit}
                    </div>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="erp-btn-outline"
                  onClick={() => setReservingItem(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="erp-btn-primary">
                  Confirm Material Reservation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
