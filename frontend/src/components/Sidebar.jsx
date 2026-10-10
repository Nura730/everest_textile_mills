import { NavLink } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { ROLES, navFor } from '../auth/roles.js';

function NavItem({ item, collapsed, label, preview = false, onNavigate }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) => `erp-sidebar-item ${isActive ? 'active' : ''}`}
      title={collapsed ? label : preview ? `${label} — preview (sample data)` : undefined}
    >
      <Icon size={18} className="erp-nav-icon" aria-hidden="true" />
      {!collapsed && (
        <>
          <span className="erp-nav-label">{label}</span>
          {preview && <span className="erp-nav-badge">Preview</span>}
        </>
      )}
    </NavLink>
  );
}

/** Navigation for the signed-in role only: live screens first, sample-data previews clearly apart. */
export default function Sidebar({ collapsed, mobileOpen, onToggle, onNavigate }) {
  const { user } = useAuth();
  const { live, preview } = navFor(user.role);

  return (
    <aside className={`erp-sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="erp-sidebar-header">
        {!collapsed && <span className="erp-sidebar-title">Menu</span>}
        <button
          type="button"
          className="erp-sidebar-toggle-btn"
          onClick={onToggle}
          title={collapsed ? 'Expand menu' : 'Collapse menu'}
          aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="erp-sidebar-nav" aria-label="Main">
        {live.map((item) => (
          <NavItem
            key={item.to}
            item={item}
            collapsed={collapsed}
            onNavigate={onNavigate}
            label={user.role === ROLES.BUYER && item.buyerLabel ? item.buyerLabel : item.label}
          />
        ))}
        {preview.length > 0 && (
          <>
            {!collapsed && <div className="sidebar-group-label">Preview modules</div>}
            {preview.map((item) => (
              <NavItem key={item.to} item={item} collapsed={collapsed} label={item.label} preview onNavigate={onNavigate} />
            ))}
          </>
        )}
      </nav>
    </aside>
  );
}
