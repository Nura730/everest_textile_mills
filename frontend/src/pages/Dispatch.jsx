import { useState } from 'react';
import { Truck, ShieldCheck, Download, Search, CheckCircle, FileText, X } from 'lucide-react';
import { useApp } from '../context/AppContext';

const statusFilters = ['All', 'Not Started', 'Awaiting QC', 'Packing', 'Shipped'];

export default function Dispatch() {
  const { dispatches, confirmDispatch, stockLedger } = useApp();
  const [activeFilter, setActiveFilter] = useState('All');
  const [signingDispatch, setSigningDispatch] = useState(null);

  const [dispatchForm, setDispatchForm] = useState({
    vehicle: 'MH-12-TX-8821',
    driver: 'Santosh Pawar',
    signature: 'Ramesh Tiwari (Store Keeper)',
  });

  const filtered = dispatches.filter((d) => {
    if (activeFilter === 'All') return true;
    return d.status === activeFilter;
  });

  const shippedCount = dispatches.filter((d) => d.status === 'Shipped').length;
  const inProgressCount = dispatches.filter((d) =>
    ['Packing', 'Awaiting QC'].includes(d.status)
  ).length;

  const handleSignSubmit = (e) => {
    e.preventDefault();
    if (signingDispatch) {
      confirmDispatch(signingDispatch.id, dispatchForm);
      setSigningDispatch(null);
    }
  };

  return (
    <div className="erp-page-container">
      <div className="erp-page-header">
        <div className="erp-page-header-text">
          <h1 className="erp-page-title">Dispatch & Logistics Management</h1>
          <p className="erp-page-subtitle">
            Section 18: Finished goods verification, duplicate prevention, and Store Keeper digital dispatch signoff
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="erp-tall-kpi-grid" style={{ marginBottom: 20 }}>
        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Scheduled Shipments</span>
            <Truck size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">{dispatches.length}</div>
          <div className="tall-kpi-subtext">Consignment manifests</div>
        </div>

        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Shipped & Delivered</span>
            <CheckCircle size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">{shippedCount}</div>
          <div className="tall-kpi-subtext">Legally signed & invoiced</div>
        </div>

        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Packing / In Staging</span>
            <Truck size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">{inProgressCount}</div>
          <div className="tall-kpi-subtext">Awaiting final carrier handoff</div>
        </div>

        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Duplicate Prevention</span>
            <ShieldCheck size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">100%</div>
          <div className="tall-kpi-subtext">Strict roll ID uniqueness enforced</div>
        </div>
      </div>

      {/* Filter */}
      <div className="erp-filter-bar">
        <div className="filter-chips-row">
          {statusFilters.map((filter) => (
            <button
              key={filter}
              className={`erp-filter-chip ${activeFilter === filter ? 'active' : ''}`}
              onClick={() => setActiveFilter(filter)}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      {/* Dispatch Table */}
      <div className="erp-card">
        <div className="erp-table-wrapper">
          <table className="erp-data-table">
            <thead>
              <tr>
                <th>Manifest ID</th>
                <th>Order Ref</th>
                <th>Customer / Destination</th>
                <th>Fabric</th>
                <th>Quantity</th>
                <th>Transport Vehicle</th>
                <th>Invoice</th>
                <th>Digital Signature</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.id}>
                  <td className="table-primary-cell">{d.id}</td>
                  <td>{d.order}</td>
                  <td>{d.customer}</td>
                  <td>{d.fabric}</td>
                  <td>{d.quantity}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{d.vehicle}</td>
                  <td>
                    {d.invoiceNumber && d.invoiceNumber !== '—' ? (
                      <span className="erp-status-badge outline">{d.invoiceNumber}</span>
                    ) : (
                      <span className="text-xs text-secondary">Pending Dispatch</span>
                    )}
                  </td>
                  <td>
                    {d.digitalSignature && d.digitalSignature !== '—' ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <ShieldCheck size={13} />
                        <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
                          {d.digitalSignature}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-secondary">—</span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`erp-status-badge ${
                        d.status === 'Shipped'
                          ? 'active'
                          : d.status === 'Packing'
                          ? 'neutral'
                          : 'outline'
                      }`}
                    >
                      {d.status}
                    </span>
                  </td>
                  <td>
                    {d.status !== 'Shipped' && (
                      <button
                        className="erp-btn-sm erp-btn-dark"
                        onClick={() => setSigningDispatch(d)}
                      >
                        <ShieldCheck size={13} />
                        <span>Sign & Dispatch</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: Dispatch Confirmation & Digital Signature (Section 11 & 18) */}
      {signingDispatch && (
        <div className="erp-modal-overlay">
          <div className="erp-modal-box">
            <div className="modal-header">
              <div>
                <h3 className="modal-title">Confirm Dispatch & Authorize Transfer</h3>
                <p className="modal-subtitle">
                  {signingDispatch.id} • Order {signingDispatch.order} ({signingDispatch.customer})
                </p>
              </div>
              <button className="modal-close-btn" onClick={() => setSigningDispatch(null)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSignSubmit}>
              <div className="modal-body">
                <div className="erp-form-grid">
                  <div className="form-group">
                    <label className="erp-label">Transport Vehicle Registration</label>
                    <input
                      type="text"
                      className="erp-input"
                      value={dispatchForm.vehicle}
                      onChange={(e) => setDispatchForm({ ...dispatchForm, vehicle: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="erp-label">Driver Name</label>
                    <input
                      type="text"
                      className="erp-input"
                      value={dispatchForm.driver}
                      onChange={(e) => setDispatchForm({ ...dispatchForm, driver: e.target.value })}
                      required
                    />
                  </div>

                  <div className="digital-signature-box" style={{ gridColumn: 'span 2' }}>
                    <div className="sig-header">
                      <ShieldCheck size={18} />
                      <strong>Section 11 Digital Signature — Final Custody Hand-off</strong>
                    </div>
                    <p className="sig-statement">
                      "I hereby certify as Store Keeper that {signingDispatch.quantity} of verified, passed finished goods rolls have been physically loaded onto transport vehicle {dispatchForm.vehicle} for buyer delivery."
                    </p>
                    <div className="form-group" style={{ marginTop: 8 }}>
                      <label className="erp-label">Store Keeper Signatory</label>
                      <input
                        type="text"
                        className="erp-input"
                        value={dispatchForm.signature}
                        onChange={(e) =>
                          setDispatchForm({ ...dispatchForm, signature: e.target.value })
                        }
                        required
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="erp-btn-outline"
                  onClick={() => setSigningDispatch(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="erp-btn-primary">
                  Generate Invoice & Confirm Dispatch
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
