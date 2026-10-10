import { Users as UsersIcon, Shield, CheckCircle, ArrowRight, Download } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { exportToCSV } from '../utils/csvExport';

export default function Users() {
  const { currentRole, setCurrentRole, roles, toast } = useApp();

  const userDirectory = [
    {
      id: 'USR-01',
      name: 'Admin / Owner',
      email: 'owner@everesttextiles.in',
      role: 'ADMIN_OWNER',
      title: 'Factory Owner & Chief Executive',
      permissions: 'Full System Access, Financial Overrides, System Config',
      status: 'Active',
    },
    {
      id: 'USR-02',
      name: 'Suresh Kumar',
      email: 'suresh.k@everesttextiles.in',
      role: 'FLOOR_MANAGER',
      title: 'Head Floor Manager',
      permissions: 'Loom Allocation, Machine Problem Logging, Production Pause/Resume',
      status: 'Active',
    },
    {
      id: 'USR-03',
      name: 'Ramesh Tiwari',
      email: 'ramesh.t@everesttextiles.in',
      role: 'STORE_KEEPER',
      title: 'Head Store Keeper',
      permissions: 'Yarn Receiving, Material Reservation, Finished Goods, Dispatch Signoff',
      status: 'Active',
    },
    {
      id: 'USR-04',
      name: 'Mohan Verma',
      email: 'mohan.v@everesttextiles.in',
      role: 'QC_INSPECTOR',
      title: 'Senior Quality Inspector',
      permissions: 'Fabric Roll Inspection, Defect Recording, Digital QC Signatures',
      status: 'Active',
    },
    {
      id: 'USR-05',
      name: 'Rajesh Mishra',
      email: 'buyer.rep@raymond.com',
      role: 'BUYER',
      title: 'Raymond Ltd. Procurement Partner',
      permissions: 'Buyer Milestone Timeline, Order Progress, Invoice Retrieval',
      status: 'Active',
    },
  ];

  const handleExportCSV = () => {
    exportToCSV('Everest_Textile_User_Directory.csv', userDirectory, [
      { key: 'id', label: 'User ID' },
      { key: 'name', label: 'Full Name' },
      { key: 'role', label: 'Role Key' },
      { key: 'email', label: 'Email Address' },
      { key: 'title', label: 'Designation' },
      { key: 'permissions', label: 'Permissions' },
      { key: 'status', label: 'Account Status' },
    ]);
    toast.info(`Exported ${userDirectory.length} users to CSV.`, 'CSV Exported');
  };

  return (
    <div className="erp-page-container">
      <div className="erp-page-header">
        <div className="erp-page-header-text">
          <h1 className="erp-page-title">Users & Role-Based Access Control (RBAC)</h1>
          <p className="erp-page-subtitle">
            Section 2: Primary factory personas, role-specific visibility boundaries, and permissions
          </p>
        </div>
        <div className="erp-page-actions">
          <button className="erp-btn-outline" onClick={handleExportCSV} title="Export personnel directory as CSV">
            <Download size={16} />
            <span>Export Directory</span>
          </button>
        </div>
      </div>

      {/* Active Role Demo Switcher Banner */}
      <div className="erp-card" style={{ marginBottom: 24, border: '2px solid var(--color-gray-900)' }}>
        <div className="card-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Shield size={20} />
              <h3 className="card-title">Currently Active Evaluation Persona</h3>
            </div>
            <p className="card-subtitle">
              Select any role below to demonstrate how the ERP adapts to that specific factory worker
            </p>
          </div>
          <span className="erp-status-badge active">{currentRole.id}</span>
        </div>

        <div className="role-switcher-grid">
          {roles.map((r) => {
            const isSelected = currentRole.id === r.id;
            return (
              <div
                key={r.id}
                className={`role-select-card ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  setCurrentRole(r);
                  toast.info(`Switched active persona to ${r.name} (${r.id}).`, 'Persona Activated');
                }}
              >
                <div className="role-card-avatar">{r.avatar}</div>
                <div className="role-card-name">{r.name}</div>
                <div className="role-card-title">{r.title}</div>
                <span className="role-card-badge">{r.id}</span>
                {isSelected && (
                  <div className="role-card-active-check">
                    <CheckCircle size={14} /> Active Persona
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* User Directory Table */}
      <div className="erp-card">
        <div className="card-header">
          <div>
            <h3 className="card-title">Authorized Factory Personnel</h3>
            <p className="card-subtitle">Role credentials and operational privilege levels</p>
          </div>
        </div>
        <div className="erp-table-wrapper">
          <table className="erp-data-table">
            <thead>
              <tr>
                <th>User ID</th>
                <th>Name</th>
                <th>Role Code</th>
                <th>Email</th>
                <th>Designation</th>
                <th>Authorized Permissions</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {userDirectory.map((user) => (
                <tr key={user.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{user.id}</td>
                  <td className="table-primary-cell">{user.name}</td>
                  <td>
                    <span className="erp-status-badge neutral">{user.role}</span>
                  </td>
                  <td style={{ color: 'var(--color-gray-600)' }}>{user.email}</td>
                  <td>{user.title}</td>
                  <td style={{ fontSize: 12, maxWidth: 300 }}>{user.permissions}</td>
                  <td>
                    <span className="erp-status-badge active">{user.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
