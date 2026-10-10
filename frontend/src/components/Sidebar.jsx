import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  ShoppingCart,
  Factory,
  Package,
  CheckSquare,
  Cog,
  Truck,
  Settings,
  ChevronLeft,
  ChevronRight,
  Layers,
} from 'lucide-react';

const navSections = [
  {
    label: 'Overview',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/orders', icon: ShoppingCart, label: 'Orders', badge: '10' },
      { to: '/production', icon: Factory, label: 'Production' },
      { to: '/inventory', icon: Package, label: 'Inventory', errorBadge: '3' },
      { to: '/quality', icon: CheckSquare, label: 'Quality Control' },
    ],
  },
  {
    label: 'Resources',
    items: [
      { to: '/machines', icon: Cog, label: 'Machines', errorBadge: '1' },
      { to: '/dispatch', icon: Truck, label: 'Dispatch' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/settings', icon: Settings, label: 'Settings' },
    ],
  },
];

export default function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }) {
  const location = useLocation();

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
      {/* Brand */}
      <div className="sidebar-brand">
        <div className="sidebar-brand-logo">
          <Layers />
        </div>
        {!collapsed && (
          <div className="sidebar-brand-text">
            Textile<span>IQ</span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {navSections.map((section) => (
          <div key={section.label}>
            {!collapsed && (
              <div className="sidebar-section-label">{section.label}</div>
            )}
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.to;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={`sidebar-link ${isActive ? 'active' : ''}`}
                  onClick={onMobileClose}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon />
                  {!collapsed && (
                    <>
                      <span>{item.label}</span>
                      {item.badge && (
                        <span className="sidebar-link-badge">{item.badge}</span>
                      )}
                      {item.errorBadge && (
                        <span className="sidebar-link-badge error">{item.errorBadge}</span>
                      )}
                    </>
                  )}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Footer Toggle */}
      <div className="sidebar-footer">
        <button className="sidebar-toggle" onClick={onToggle}>
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>
    </aside>
  );
}
