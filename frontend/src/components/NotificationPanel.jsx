import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  AlertTriangle,
  AlertOctagon,
  Info,
  Check,
  CheckCheck,
  Trash2,
  X,
  ExternalLink,
} from 'lucide-react';
import { useApp } from '../context/AppContext';

export default function NotificationPanel({ isOpen, onClose }) {
  const navigate = useNavigate();
  const {
    notifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    clearAllNotifications,
  } = useApp();

  const [activeFilter, setActiveFilter] = useState('ALL');

  if (!isOpen) return null;

  const unreadCount = notifications.filter((n) => n.unread).length;

  const filteredNotifications = notifications.filter((n) => {
    if (activeFilter === 'UNREAD') return n.unread;
    if (activeFilter === 'CRITICAL') return n.type === 'CRITICAL';
    return true;
  });

  const handleNotificationClick = (notif) => {
    markNotificationAsRead(notif.id);
    if (notif.link) {
      navigate(notif.link);
      onClose();
    }
  };

  const getIcon = (type) => {
    switch (type) {
      case 'SUCCESS':
        return <CheckCircle2 size={15} className="notif-icon-success" />;
      case 'WARNING':
        return <AlertTriangle size={15} className="notif-icon-warning" />;
      case 'CRITICAL':
        return <AlertOctagon size={15} className="notif-icon-critical" />;
      case 'INFO':
      default:
        return <Info size={15} className="notif-icon-info" />;
    }
  };

  return (
    <div className="erp-dropdown-menu notifications-menu" role="dialog" aria-label="System Notifications">
      <div className="dropdown-header">
        <div className="notif-header-title-row">
          <strong>Notifications & Risk Alerts</strong>
          {unreadCount > 0 && (
            <span className="notif-unread-count-pill">{unreadCount} unread</span>
          )}
        </div>
        <div className="notif-header-actions">
          {unreadCount > 0 && (
            <button
              type="button"
              className="notif-header-action-btn"
              onClick={markAllNotificationsAsRead}
              title="Mark all notifications as read"
            >
              <CheckCheck size={14} />
              <span>Mark all read</span>
            </button>
          )}
          {notifications.length > 0 && (
            <button
              type="button"
              className="notif-header-action-btn"
              onClick={clearAllNotifications}
              title="Clear all notifications"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="notif-filter-tabs">
        <button
          type="button"
          className={`notif-filter-tab ${activeFilter === 'ALL' ? 'active' : ''}`}
          onClick={() => setActiveFilter('ALL')}
        >
          All ({notifications.length})
        </button>
        <button
          type="button"
          className={`notif-filter-tab ${activeFilter === 'UNREAD' ? 'active' : ''}`}
          onClick={() => setActiveFilter('UNREAD')}
        >
          Unread ({unreadCount})
        </button>
        <button
          type="button"
          className={`notif-filter-tab ${activeFilter === 'CRITICAL' ? 'active' : ''}`}
          onClick={() => setActiveFilter('CRITICAL')}
        >
          Critical ({notifications.filter((n) => n.type === 'CRITICAL').length})
        </button>
      </div>

      {/* Notification List */}
      <div className="notifications-list">
        {filteredNotifications.length === 0 ? (
          <div className="notif-empty-state">
            <CheckCircle2 size={28} className="text-muted" style={{ marginBottom: 6 }} />
            <p className="notif-empty-text">No notifications found.</p>
            <span className="text-xs text-secondary">All production alerts are clear.</span>
          </div>
        ) : (
          filteredNotifications.map((notif) => (
            <div
              key={notif.id}
              className={`notification-item ${notif.unread ? 'unread' : 'read'} notif-severity-${notif.type.toLowerCase()}`}
              onClick={() => handleNotificationClick(notif)}
              role="button"
              tabIndex={0}
            >
              <div className="notification-item-icon">
                {getIcon(notif.type)}
              </div>
              <div className="notification-item-body">
                <div className="notification-item-title-row">
                  <span className="notification-item-title">{notif.title}</span>
                  {notif.unread && <span className="unread-dot" title="Unread" />}
                </div>
                <div className="notification-item-desc">{notif.message}</div>
                <div className="notification-item-footer">
                  <span className="notification-item-time">{notif.timestamp}</span>
                  {notif.link && (
                    <span className="notification-item-link-hint">
                      View <ExternalLink size={11} style={{ marginLeft: 2 }} />
                    </span>
                  )}
                  {notif.unread && (
                    <button
                      type="button"
                      className="notif-inline-read-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        markNotificationAsRead(notif.id);
                      }}
                      title="Mark as read"
                    >
                      <Check size={12} /> Mark read
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
