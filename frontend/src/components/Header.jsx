import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  Wifi,
  WifiOff,
  ChevronDown,
  CheckCircle,
  Settings,
  Users,
  LogOut,
  Shield,
  Activity,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import NotificationPanel from './NotificationPanel';

export default function Header() {
  const navigate = useNavigate();
  const {
    currentRole,
    setCurrentRole,
    roles,
    isOffline,
    setIsOffline,
    pendingSyncQueue,
    triggerSync,
    notifications,
    toast,
  } = useApp();

  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const menuRef = useRef(null);
  const notifRef = useRef(null);

  const unreadCount = notifications ? notifications.filter((n) => n.unread).length : 0;

  // Close dropdowns on click outside or Escape
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowRoleMenu(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setShowNotifications(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setShowRoleMenu(false);
        setShowNotifications(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleLogout = () => {
    setShowRoleMenu(false);
    toast.info('Logged out. Switched back to Executive Admin persona.');
    setCurrentRole(roles[0]);
    navigate('/dashboard');
  };

  return (
    <header className="erp-header">
      <div className="erp-header-left">
        <div className="erp-brand-title" onClick={() => navigate('/dashboard')} style={{ cursor: 'pointer' }}>
          Manufacturing ERP
          <span className="erp-brand-mill-sub">Everest Textile Mills</span>
        </div>
      </div>

      <div className="erp-header-right">
        {/* Offline / Online Sync Indicator (Section 16) */}
        <button
          type="button"
          className={`sync-indicator-btn ${isOffline ? 'offline' : 'online'}`}
          onClick={() => {
            if (isOffline) {
              triggerSync();
            } else {
              setIsOffline(true);
              toast.warning('Offline mode simulated. Local transactions will be queued.', 'Offline Active');
            }
          }}
          title={
            isOffline
              ? `Offline mode active (${pendingSyncQueue.length} queued). Click to sync.`
              : 'Live connected to central ERP database. Click to test offline simulation.'
          }
        >
          {isOffline ? <WifiOff size={13} /> : <Wifi size={13} />}
          <span>{isOffline ? `Offline (${pendingSyncQueue.length})` : 'Live Online'}</span>
        </button>

        {/* Notifications Bell (Section 4) */}
        <div style={{ position: 'relative' }} ref={notifRef}>
          <button
            type="button"
            className="erp-icon-btn"
            title="Notifications & Production Alerts"
            onClick={() => {
              setShowNotifications(!showNotifications);
              setShowRoleMenu(false);
            }}
            aria-expanded={showNotifications}
            aria-label="Open notifications"
          >
            <Bell size={18} />
            {unreadCount > 0 && <span className="erp-notification-badge">{unreadCount}</span>}
          </button>

          <NotificationPanel
            isOpen={showNotifications}
            onClose={() => setShowNotifications(false)}
          />
        </div>

        {/* User Role Profile & Menu (Reference Screenshot match: msg / Admin / M) */}
        <div style={{ position: 'relative' }} ref={menuRef}>
          <button
            type="button"
            className="erp-user-profile-btn"
            onClick={() => {
              setShowRoleMenu(!showRoleMenu);
              setShowNotifications(false);
            }}
            title="User Profile & Role Switching"
            aria-expanded={showRoleMenu}
          >
            <div className="erp-user-info">
              <span className="erp-user-code">{currentRole.code || 'msg'}</span>
              <span className="erp-user-role-label">{currentRole.name === 'Admin' ? 'Admin' : currentRole.name}</span>
            </div>
            <div className="erp-user-avatar">{currentRole.avatar}</div>
          </button>

          {showRoleMenu && (
            <div className="erp-dropdown-menu role-menu" role="menu">
              <div className="dropdown-header">
                <div>
                  <strong>{currentRole.name}</strong>
                  <div className="text-xs text-secondary">{currentRole.title}</div>
                </div>
                <span className="role-current-tag">{currentRole.id}</span>
              </div>

              {/* Role Switcher Section for Evaluation */}
              <div className="menu-section-label">SWITCH DEMO PERSONA (RBAC)</div>
              <div className="role-options-list">
                {roles.map((r) => (
                  <div
                    key={r.id}
                    className={`role-option ${currentRole.id === r.id ? 'active' : ''}`}
                    onClick={() => {
                      setCurrentRole(r);
                      setShowRoleMenu(false);
                      toast.info(`Switched persona to ${r.name} (${r.id}).`);
                    }}
                    role="menuitem"
                  >
                    <div className="role-avatar">{r.avatar}</div>
                    <div className="role-info">
                      <div className="role-title-row">
                        <strong>{r.name}</strong>
                        <span className="role-badge">{r.id}</span>
                      </div>
                      <div className="role-desc">{r.title}</div>
                    </div>
                    {currentRole.id === r.id && <CheckCircle size={15} className="text-neutral" />}
                  </div>
                ))}
              </div>

              {/* Quick Actions */}
              <div className="dropdown-divider" />
              <div
                className="role-menu-action"
                onClick={() => {
                  setShowRoleMenu(false);
                  navigate('/users');
                }}
                role="menuitem"
              >
                <Users size={14} />
                <span>Manage Users & Roles</span>
              </div>
              <div
                className="role-menu-action"
                onClick={() => {
                  setShowRoleMenu(false);
                  navigate('/settings');
                }}
                role="menuitem"
              >
                <Settings size={14} />
                <span>System Settings</span>
              </div>
              <div
                className="role-menu-action text-red"
                onClick={handleLogout}
                role="menuitem"
              >
                <LogOut size={14} />
                <span>Reset Session / Sign Out</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
