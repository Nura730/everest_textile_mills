import { useState, useMemo } from 'react';
import {
  Package,
  Search,
  Plus,
  AlertTriangle,
  Download,
  BookmarkPlus,
  X,
  CheckCircle2,
  Boxes,
  ArrowUpDown,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { exportToCSV } from '../utils/csvExport';

const categoryFilters = ['All', 'Yarn', 'Fiber', 'Dye', 'Chemical', 'Parts'];

export default function Inventory() {
  const { inventory, reserveYarn, orders, toast } = useApp();
  const [activeFilter, setActiveFilter] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [reservingItem, setReservingItem] = useState(null);
  const [reserveAmount, setReserveAmount] = useState(250);
  const [reserveOrderId, setReserveOrderId] = useState(orders[0]?.id || 'ORD-2410-001');

  const filtered = useMemo(() => {
    return inventory.filter((item) => {
      const matchesFilter = activeFilter === 'All' || item.category === activeFilter;
      const matchesSearch =
        !searchTerm ||
        item.name.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        item.id.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        item.color.toLowerCase().includes(searchTerm.toLowerCase().trim()) ||
        item.supplier.toLowerCase().includes(searchTerm.toLowerCase().trim());
      return matchesFilter && matchesSearch;
    });
  }, [inventory, activeFilter, searchTerm]);

  const shortageCount = inventory.filter((i) => i.shortage).length;

  const handleReserveSubmit = (e) => {
    e.preventDefault();
    if (reservingItem) {
      reserveYarn(reservingItem.id, reserveAmount, reserveOrderId);
      toast.success(
        `Reserved ${reserveAmount.toLocaleString()} ${reservingItem.unit} of ${reservingItem.name} for ${reserveOrderId}.`,
        'Material Reserved'
      );
      setReservingItem(null);
    }
  };

  const handleExportStock = () => {
    const success = exportToCSV('inventory_stock_balance', inventory, [
      { key: 'id', label: 'Item SKU' },
      { key: 'name', label: 'Material Specification' },
      { key: 'category', label: 'Category' },
      { key: 'color', label: 'Shade / Color' },
      { key: 'totalStock', label: 'Physical Total' },
      { key: 'reservedStock', label: 'Reserved Stock' },
      { key: 'availableStock', label: 'Available Stock' },
      { key: 'unit', label: 'Unit' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'lotNumber', label: 'Lot Batch' },
      { key: 'location', label: 'Storage Bin' },
    ]);
    if (success) {
      toast.success('Inventory stock report exported to CSV successfully.', 'Export Complete');
    }
  };

  return (
    <div className="erp-page-container">
      <div className="erp-page-header">
        <div className="erp-page-header-text">
          <h1 className="erp-page-title">Raw Material Inventory</h1>
          <p className="erp-page-subtitle">
            Yarn Lot Tracking, E-Commerce Style Reservation, Available vs Reserved Stock
          </p>
        </div>
        <div className="erp-page-actions">
          <button type="button" className="erp-btn-outline" onClick={handleExportStock} title="Export stock table to CSV">
            <Download size={16} />
            <span>Export Stock</span>
          </button>
        </div>
      </div>

      {/* Shortage Alert */}
      {shortageCount > 0 && (
        <div className="erp-alert-box">
          <div className="erp-alert-icon">
            <AlertTriangle size={20} className="text-warning" />
          </div>
          <div className="erp-alert-content">
            <div className="erp-alert-title">
              Buffer Deficit Warning: {shortageCount} Materials Under Safety Stock Limit
            </div>
            <div className="erp-alert-desc">
              Materials highlighted below have fallen below the mandatory mill replenishment buffer. Reorder requisitions recommended.
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
            <Boxes size={16} className="tall-kpi-icon" />
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

      {/* Filters and Search Bar */}
      <div className="erp-filter-bar">
        <div className="filter-chips-row">
          {categoryFilters.map((filter) => (
            <button
              key={filter}
              type="button"
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

      {/* Table with Visual Stock Indicators (Section 11) */}
      <div className="erp-card">
        <div className="erp-table-wrapper">
          <table className="erp-data-table">
            <thead>
              <tr>
                <th>Item ID</th>
                <th>Material Specification</th>
                <th>Category</th>
                <th>Color / Shade</th>
                <th style={{ minWidth: 200 }}>Stock Availability Bar</th>
                <th>Reserved Stock</th>
                <th>Available Stock</th>
                <th>Supplier & Lot</th>
                <th>Storage Bin</th>
                <th style={{ textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const availPercent = item.totalStock > 0 ? Math.round((item.availableStock / item.totalStock) * 100) : 0;
                const isLow = item.shortage;

                return (
                  <tr key={item.id}>
                    <td className="table-primary-cell font-mono">{item.id}</td>
                    <td>
                      <div>
                        <strong>{item.name}</strong>
                        <div className="text-xs text-secondary">
                          Min Safety Buffer: {item.minStock.toLocaleString()} {item.unit}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="erp-status-badge outline">{item.category}</span>
                    </td>
                    <td>{item.color}</td>

                    {/* Section 11 Visual Stock Indicator */}
                    <td>
                      <div className="visual-stock-bar-wrap">
                        <div className="stock-label-split">
                          <span className="text-xs">
                            Available: <strong>{item.availableStock.toLocaleString()} {item.unit}</strong>
                          </span>
                          <span className="text-xs text-secondary">
                            Total: {item.totalStock.toLocaleString()} {item.unit}
                          </span>
                        </div>
                        <div className="stock-ratio-progress">
                          <div
                            className={`stock-ratio-fill ${isLow ? 'low' : ''}`}
                            style={{ width: `${Math.min(100, Math.max(0, availPercent))}%` }}
                          />
                        </div>
                        <div className="stock-reserved-caption">
                          Reserved: {item.reservedStock.toLocaleString()} {item.unit} ({100 - availPercent}%)
                        </div>
                      </div>
                    </td>

                    <td>
                      <span style={{ color: 'var(--color-gray-700)', fontWeight: 500 }}>
                        {item.reservedStock.toLocaleString()} {item.unit}
                      </span>
                    </td>
                    <td>
                      <div>
                        <strong style={{ color: isLow ? 'var(--color-error)' : 'var(--color-gray-900)' }}>
                          {item.availableStock.toLocaleString()} {item.unit}
                        </strong>
                        {isLow && (
                          <div className="erp-status-badge error" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginTop: 3 }}>
                            <AlertTriangle size={11} />
                            <span>LOW STOCK</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td>
                      <div>
                        <div style={{ fontSize: 12 }}>{item.supplier}</div>
                        <div className="text-xs text-secondary font-mono">
                          {item.lotNumber}
                        </div>
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--color-gray-600)' }}>{item.location}</td>
                    <td style={{ textAlign: 'right' }}>
                      {item.category === 'Yarn' && (
                        <button
                          type="button"
                          className="erp-btn-sm erp-btn-outline"
                          onClick={() => {
                            setReservingItem(item);
                            setReserveAmount(Math.min(item.availableStock, 500));
                          }}
                          disabled={item.availableStock <= 0}
                          title="Reserve material for production order"
                        >
                          <BookmarkPlus size={13} style={{ marginRight: 3 }} />
                          <span>Reserve</span>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: Yarn Reservation */}
      {reservingItem && (
        <div className="erp-modal-overlay" onClick={() => setReservingItem(null)}>
          <div className="erp-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title">Material Reservation Allocation</h3>
                <p className="modal-subtitle">
                  {reservingItem.name} ({reservingItem.color}) • Lot {reservingItem.lotNumber}
                </p>
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setReservingItem(null)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleReserveSubmit}>
              <div className="modal-body">
                <div className="reservation-metric-banner">
                  <div className="reserve-stat">
                    <span className="text-xs text-secondary">Total Physical</span>
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
                    <span className="text-xs text-secondary">Available to Allocate</span>
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
