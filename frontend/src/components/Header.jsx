import { useState } from 'react';
import { Bell, Wifi, WifiOff, ChevronDown, CheckCircle, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext';

export default function Header() {
  const { currentRole, setCurrentRole, roles, isOffline, setIsOffline, pendingSyncQueue, triggerSync, alerts } =
    useApp();
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  return (
    <header className="erp-header">
      <div className="erp-header-left">
        <div className="erp-brand-title">
          Everest Textile Mills
        </div>
      </div>

      <div className="erp-header-right">
        {/* Offline / Online Sync Indicator (Section 14 & 15) */}
        <button
          className={`sync-indicator-btn ${isOffline ? 'offline' : 'online'}`}
          onClick={() => {
            if (isOffline) {
              triggerSync();
            } else {
              setIsOffline(true);
            }
          }}
          title={isOffline ? 'Offline mode active (Click to simulate online sync)' : 'Connected to Central ERP (Click to simulate floor offline mode)'}
        >
          {isOffline ? <WifiOff size={14} /> : <Wifi size={14} />}
          <span>{isOffline ? `Offline (${pendingSyncQueue.length} queued)` : 'Live Synced'}</span>
        </button>

        {/* Notifications */}
        <div style={{ position: 'relative' }}>
          <button
            className="erp-icon-btn"
            title="Notifications & Risk Alerts"
            onClick={() => {
              setShowNotifications(!showNotifications);
              setShowRoleMenu(false);
            }}
          >
            <Bell size={18} />
            {alerts.length > 0 && <span className="erp-notification-badge">{alerts.length}</span>}
          </button>

          {showNotifications && (
            <div className="erp-dropdown-menu notifications-menu">
              <div className="dropdown-header">
                <strong>System Alerts & Risk Warnings</strong>
                <span className="text-xs text-secondary">{alerts.length} active</span>
              </div>
              <div className="notifications-list">
                {alerts.map((alert) => (
                  <div key={alert.id} className="notification-item">
                    <div className="notification-item-icon">
                      <AlertTriangle size={15} style={{ color: 'var(--color-error)' }} />
                    </div>
                    <div className="notification-item-body">
                      <div className="notification-item-title">{alert.title}</div>
                      <div className="notification-item-desc">{alert.reason}</div>
                      <div className="notification-item-rec">
                        <strong>Rec:</strong> {alert.recommendation}
                      </div>
                      <div className="notification-item-time">{alert.timestamp}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* User Role Profile & Role Switcher */}
        <div style={{ position: 'relative' }}>
          <button
            className="erp-user-profile-btn"
            onClick={() => {
              setShowRoleMenu(!showRoleMenu);
              setShowNotifications(false);
            }}
            title="Switch User Role for Evaluation Demo"
          >
            <div className="erp-user-info">
              <span className="erp-user-code">{currentRole.code}</span>
              <span className="erp-user-name">{currentRole.name}</span>
            </div>
            <div className="erp-user-avatar">{currentRole.avatar}</div>
            <ChevronDown size={14} style={{ color: 'var(--color-gray-500)', marginLeft: 2 }} />
          </button>

          {showRoleMenu && (
            <div className="erp-dropdown-menu role-menu">
              <div className="dropdown-header">
                <strong>Switch Demo Role</strong>
                <span className="text-xs text-secondary">RBAC View</span>
              </div>
              {roles.map((r) => (
                <div
                  key={r.id}
                  className={`role-option ${currentRole.id === r.id ? 'active' : ''}`}
                  onClick={() => {
                    setCurrentRole(r);
                    setShowRoleMenu(false);
                  }}
                >
                  <div className="role-avatar">{r.avatar}</div>
                  <div className="role-info">
                    <div className="role-title-row">
                      <strong>{r.name}</strong>
                      <span className="role-badge">{r.id}</span>
                    </div>
                    <div className="role-desc">{r.title}</div>
                  </div>
                  {currentRole.id === r.id && <CheckCircle size={16} />}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
