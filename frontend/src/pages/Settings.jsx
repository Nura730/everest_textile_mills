import { useState } from 'react';
import {
  Settings as SettingsIcon,
  User,
  Building,
  Bell,
  Shield,
  Database,
  Wifi,
  WifiOff,
  CheckCircle,
  RotateCcw,
} from 'lucide-react';
import { useApp } from '../context/AppContext';

const sections = [
  { id: 'general', label: 'Mill Configuration', icon: Building },
  { id: 'offline', label: 'Offline-First & Sync (Sec. 14)', icon: Database },
  { id: 'security', label: 'Security & Signatures', icon: Shield },
];

export default function Settings() {
  const { isOffline, setIsOffline, pendingSyncQueue, triggerSync } = useApp();
  const [activeSection, setActiveSection] = useState('general');
  const [millName, setMillName] = useState('Everest Textile Mills');
  const [savedNotice, setSavedNotice] = useState(false);

  const handleSave = (e) => {
    e.preventDefault();
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
  };

  return (
    <div className="erp-page-container">
      <div className="erp-page-header">
        <div className="erp-page-header-text">
          <h1 className="erp-page-title">System Settings & Architecture</h1>
          <p className="erp-page-subtitle">
            Mill operational parameters, Dexie/IndexedDB offline sync diagnostics, and security configurations
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24 }}>
        {/* Settings Sub-nav */}
        <div style={{ width: 240, flexShrink: 0 }}>
          <div className="erp-card" style={{ padding: 8 }}>
            {sections.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  className={`erp-sidebar-item ${activeSection === section.id ? 'active' : ''}`}
                  onClick={() => setActiveSection(section.id)}
                  style={{ width: '100%', marginBottom: 4 }}
                >
                  <Icon size={16} />
                  <span>{section.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Content Panel */}
        <div style={{ flex: 1 }}>
          {activeSection === 'general' && (
            <div className="erp-card">
              <div className="card-header">
                <div>
                  <h3 className="card-title">Mill Identity & Base Parameters</h3>
                  <p className="card-subtitle">Global factory enterprise setup</p>
                </div>
              </div>

              <form onSubmit={handleSave} style={{ maxWidth: 500, marginTop: 12 }}>
                <div className="form-group" style={{ marginBottom: 14 }}>
                  <label className="erp-label">Textile Mill Legal Name</label>
                  <input
                    type="text"
                    className="erp-input"
                    value={millName}
                    onChange={(e) => setMillName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 14 }}>
                  <label className="erp-label">Manufacturing Plant Location</label>
                  <input
                    type="text"
                    className="erp-input"
                    defaultValue="GIDC Industrial Estate, Surat, Gujarat, India"
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 14 }}>
                  <label className="erp-label">GSTIN / Tax Identification</label>
                  <input
                    type="text"
                    className="erp-input"
                    defaultValue="24AAACE9876K1ZQ"
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 14 }}>
                  <label className="erp-label">Operating Currency</label>
                  <select className="erp-select">
                    <option>INR (₹) — Indian Rupee</option>
                    <option>USD ($) — US Dollar</option>
                    <option>EUR (€) — Euro</option>
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: 20 }}>
                  <label className="erp-label">Standard Shift Architecture</label>
                  <select className="erp-select">
                    <option>3 Shifts × 8 Hours (24hr continuous spinning/weaving)</option>
                    <option>2 Shifts × 12 Hours</option>
                  </select>
                </div>

                <button type="submit" className="erp-btn-primary">
                  Save Changes
                </button>
                {savedNotice && (
                  <span style={{ marginLeft: 12, fontSize: 13, color: 'var(--color-black)', fontWeight: 500 }}>
                    ✓ Settings saved successfully
                  </span>
                )}
              </form>
            </div>
          )}

          {activeSection === 'offline' && (
            <div className="erp-card">
              <div className="card-header">
                <div>
                  <h3 className="card-title">Offline-First Synchronization Engine</h3>
                  <p className="card-subtitle">
                    Section 14 & 15: Dexie.js / IndexedDB client transactions and idempotency verification
                  </p>
                </div>
              </div>

              <div className="offline-status-box" style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {isOffline ? (
                      <WifiOff size={24} style={{ color: 'var(--color-error)' }} />
                    ) : (
                      <Wifi size={24} style={{ color: 'var(--color-black)' }} />
                    )}
                    <div>
                      <strong>
                        Current Network State: {isOffline ? 'OFFLINE (Floor Storage Mode)' : 'CONNECTED (Central ERP Live)'}
                      </strong>
                      <div className="text-xs text-secondary">
                        {isOffline
                          ? 'Transactions saved to browser IndexedDB with unique UUID transaction IDs.'
                          : 'Zero network latency. Bidirectional sync active with backend.'}
                      </div>
                    </div>
                  </div>

                  <button
                    className={`erp-btn-sm ${isOffline ? 'erp-btn-dark' : 'erp-btn-outline'}`}
                    onClick={() => {
                      if (isOffline) {
                        triggerSync();
                      } else {
                        setIsOffline(true);
                      }
                    }}
                  >
                    {isOffline ? 'Simulate Reconnection & Sync' : 'Simulate Offline Floor Disconnect'}
                  </button>
                </div>

                <div className="erp-table-wrapper" style={{ marginTop: 16 }}>
                  <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600 }}>
                    Pending Sync Queue ({pendingSyncQueue.length} transactions waiting)
                  </div>
                  {pendingSyncQueue.length === 0 ? (
                    <div style={{ padding: '16px 0', color: 'var(--color-gray-500)', fontSize: 13 }}>
                      All local offline transactions are fully synchronized with MongoDB.
                    </div>
                  ) : (
                    <table className="erp-data-table">
                      <thead>
                        <tr>
                          <th>Transaction ID</th>
                          <th>Action</th>
                          <th>Actor</th>
                          <th>Timestamp</th>
                          <th>Sync Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingSyncQueue.map((item) => (
                          <tr key={item.txnId}>
                            <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{item.txnId}</td>
                            <td>{item.event.action}</td>
                            <td>{item.event.actorName}</td>
                            <td>{item.event.timestamp}</td>
                            <td>
                              <span className="erp-status-badge outline">Pending Retry</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeSection === 'security' && (
            <div className="erp-card">
              <div className="card-header">
                <div>
                  <h3 className="card-title">Digital Signatures & Cryptography</h3>
                  <p className="card-subtitle">
                    Section 11: Selective high-accountability business boundaries (QC Approval & Dispatch Hand-off)
                  </p>
                </div>
              </div>

              <div style={{ marginTop: 16, fontSize: 13, lineHeight: 1.6 }}>
                <p style={{ marginBottom: 12 }}>
                  In accordance with the hackathon engineering requirements, digital signatures are applied strictly at two formal handoff boundaries:
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                  <div className="erp-card" style={{ padding: 14 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>1. QC Approval Boundary</div>
                    <p className="text-xs text-secondary">
                      Ensures a certified inspector takes full traceability responsibility before moving rolls into finished goods inventory.
                    </p>
                  </div>
                  <div className="erp-card" style={{ padding: 14 }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>2. Dispatch Carrier Boundary</div>
                    <p className="text-xs text-secondary">
                      Ensures Store Keeper legally signs off on physical vehicle loading and prevents duplicate invoice creation.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
