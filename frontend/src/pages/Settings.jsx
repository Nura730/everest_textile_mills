import { useState } from 'react';
import { Settings as SettingsIcon, User, Building, Bell, Shield, Database, Globe, Save } from 'lucide-react';

const sections = [
  { id: 'general', label: 'General', icon: Building },
  { id: 'users', label: 'Users & Roles', icon: User },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'security', label: 'Security', icon: Shield },
  { id: 'integrations', label: 'Integrations', icon: Database },
];

export default function Settings() {
  const [activeSection, setActiveSection] = useState('general');

  return (
    <div>
      <div className="page-header">
        <div className="page-header-info">
          <h1>Settings</h1>
          <p>System configuration and preferences</p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 'var(--space-4)' }}>
        {/* Settings Nav */}
        <div style={{ width: 220, flexShrink: 0 }}>
          <div className="card" style={{ padding: 'var(--space-2)' }}>
            {sections.map(section => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  className={`sidebar-link ${activeSection === section.id ? 'active' : ''}`}
                  onClick={() => setActiveSection(section.id)}
                  style={{ width: '100%' }}
                >
                  <Icon size={16} />
                  <span>{section.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Settings Content */}
        <div style={{ flex: 1 }}>
          {activeSection === 'general' && (
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">General Settings</div>
                  <div className="card-subtitle">Mill information and global preferences</div>
                </div>
              </div>

              <div style={{ maxWidth: 480 }}>
                <div className="form-group">
                  <label className="form-label">Mill Name</label>
                  <input className="form-input" type="text" defaultValue="Everest Textile Mills" />
                </div>

                <div className="form-group">
                  <label className="form-label">Location</label>
                  <input className="form-input" type="text" defaultValue="Surat, Gujarat, India" />
                </div>

                <div className="form-group">
                  <label className="form-label">GSTIN</label>
                  <input className="form-input" type="text" defaultValue="24AABCE1234F1ZH" />
                </div>

                <div className="form-group">
                  <label className="form-label">Currency</label>
                  <select className="form-input form-select">
                    <option>INR (₹) — Indian Rupee</option>
                    <option>USD ($) — US Dollar</option>
                    <option>EUR (€) — Euro</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Default Shift Duration</label>
                  <select className="form-input form-select">
                    <option>8 Hours</option>
                    <option>10 Hours</option>
                    <option>12 Hours</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Production Unit</label>
                  <select className="form-input form-select">
                    <option>Meters (m)</option>
                    <option>Yards (yd)</option>
                    <option>Kilograms (kg)</option>
                  </select>
                </div>

                <hr className="divider" />

                <div className="form-group">
                  <label className="form-label">Timezone</label>
                  <select className="form-input form-select">
                    <option>Asia/Kolkata (IST, UTC+5:30)</option>
                    <option>Asia/Dubai (GST, UTC+4)</option>
                    <option>Europe/London (GMT, UTC+0)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Date Format</label>
                  <select className="form-input form-select">
                    <option>YYYY-MM-DD</option>
                    <option>DD/MM/YYYY</option>
                    <option>MM/DD/YYYY</option>
                  </select>
                </div>

                <div style={{ marginTop: 'var(--space-6)' }}>
                  <button className="btn btn-primary">
                    <Save size={16} />
                    Save Changes
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'users' && (
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Users & Roles</div>
                  <div className="card-subtitle">Manage team members and their access levels</div>
                </div>
                <button className="btn btn-primary btn-sm">
                  <User size={14} />
                  Add User
                </button>
              </div>

              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Department</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="table-cell-primary">Suresh Kumar</td>
                    <td>suresh.k@everesttextiles.com</td>
                    <td><span className="badge badge-dark">Plant Manager</span></td>
                    <td>Management</td>
                    <td><span className="badge badge-neutral">Active</span></td>
                  </tr>
                  <tr>
                    <td className="table-cell-primary">Kavita Shah</td>
                    <td>kavita.s@everesttextiles.com</td>
                    <td><span className="badge badge-outline">QC Inspector</span></td>
                    <td>Quality</td>
                    <td><span className="badge badge-neutral">Active</span></td>
                  </tr>
                  <tr>
                    <td className="table-cell-primary">Rajesh Khanna</td>
                    <td>rajesh.k@everesttextiles.com</td>
                    <td><span className="badge badge-outline">Machine Operator</span></td>
                    <td>Production</td>
                    <td><span className="badge badge-neutral">Active</span></td>
                  </tr>
                  <tr>
                    <td className="table-cell-primary">Priya Thakur</td>
                    <td>priya.t@everesttextiles.com</td>
                    <td><span className="badge badge-outline">QC Inspector</span></td>
                    <td>Quality</td>
                    <td><span className="badge badge-neutral">Active</span></td>
                  </tr>
                  <tr>
                    <td className="table-cell-primary">Amit Patel</td>
                    <td>amit.p@everesttextiles.com</td>
                    <td><span className="badge badge-outline">Stores Manager</span></td>
                    <td>Inventory</td>
                    <td><span className="badge badge-neutral">Active</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {activeSection === 'notifications' && (
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Notification Preferences</div>
                  <div className="card-subtitle">Configure how and when you receive alerts</div>
                </div>
              </div>

              <div style={{ maxWidth: 520 }}>
                {[
                  { label: 'Machine errors and breakdowns', description: 'Immediate notification when a machine reports an error', defaultChecked: true },
                  { label: 'Material shortage alerts', description: 'When stock falls below minimum level', defaultChecked: true },
                  { label: 'QC failure notifications', description: 'When an inspection fails quality checks', defaultChecked: true },
                  { label: 'Order deadline reminders', description: '3 days before order delivery deadline', defaultChecked: true },
                  { label: 'Production run completions', description: 'When a production run reaches 100%', defaultChecked: false },
                  { label: 'Dispatch confirmations', description: 'When a shipment is dispatched', defaultChecked: false },
                  { label: 'Maintenance reminders', description: '2 days before scheduled maintenance', defaultChecked: true },
                ].map((item, index) => (
                  <div key={index} style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    padding: 'var(--space-4) 0',
                    borderBottom: 'var(--border-light)',
                  }}>
                    <div>
                      <div style={{ fontWeight: 500, fontSize: 'var(--font-size-md)', color: 'var(--color-gray-900)' }}>
                        {item.label}
                      </div>
                      <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-500)', marginTop: 2 }}>
                        {item.description}
                      </div>
                    </div>
                    <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, flexShrink: 0, marginLeft: 'var(--space-4)' }}>
                      <input type="checkbox" defaultChecked={item.defaultChecked} style={{ opacity: 0, width: 0, height: 0, position: 'absolute' }} />
                      <span style={{
                        position: 'absolute',
                        cursor: 'pointer',
                        inset: 0,
                        background: item.defaultChecked ? 'var(--color-gray-900)' : 'var(--color-gray-300)',
                        borderRadius: 11,
                        transition: 'var(--transition-normal)',
                      }}>
                        <span style={{
                          position: 'absolute',
                          left: item.defaultChecked ? 20 : 2,
                          top: 2,
                          width: 18,
                          height: 18,
                          background: 'var(--color-white)',
                          borderRadius: '50%',
                          transition: 'var(--transition-normal)',
                        }} />
                      </span>
                    </label>
                  </div>
                ))}

                <div style={{ marginTop: 'var(--space-6)' }}>
                  <button className="btn btn-primary">
                    <Save size={16} />
                    Save Preferences
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'security' && (
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Security</div>
                  <div className="card-subtitle">Authentication and access control</div>
                </div>
              </div>

              <div style={{ maxWidth: 480 }}>
                <div className="form-group">
                  <label className="form-label">Session Timeout</label>
                  <select className="form-input form-select">
                    <option>30 minutes</option>
                    <option>1 hour</option>
                    <option>4 hours</option>
                    <option>8 hours</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Minimum Password Length</label>
                  <select className="form-input form-select">
                    <option>8 characters</option>
                    <option>12 characters</option>
                    <option>16 characters</option>
                  </select>
                </div>

                <hr className="divider" />

                <div style={{ marginTop: 'var(--space-4)' }}>
                  <button className="btn btn-primary">
                    <Save size={16} />
                    Save Settings
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeSection === 'integrations' && (
            <div className="card">
              <div className="card-header">
                <div>
                  <div className="card-title">Integrations</div>
                  <div className="card-subtitle">Connect external services and systems</div>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {[
                  { name: 'Odoo ERP', description: 'Sync orders, invoices, and inventory with Odoo', connected: true },
                  { name: 'Tally Prime', description: 'Financial accounting integration', connected: false },
                  { name: 'SMS Gateway', description: 'Send dispatch and alert notifications via SMS', connected: true },
                  { name: 'IoT Sensor Hub', description: 'Machine telemetry and real-time monitoring', connected: false },
                ].map((item, index) => (
                  <div key={index} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: 'var(--space-4)',
                    border: 'var(--border-light)',
                    borderRadius: 'var(--radius-md)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <div style={{
                        width: 40,
                        height: 40,
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--color-gray-150)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}>
                        <Database size={18} style={{ color: 'var(--color-gray-600)' }} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--color-gray-900)' }}>{item.name}</div>
                        <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-gray-500)' }}>{item.description}</div>
                      </div>
                    </div>
                    <button className={`btn btn-sm ${item.connected ? 'btn-secondary' : 'btn-primary'}`}>
                      {item.connected ? 'Configured' : 'Connect'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
