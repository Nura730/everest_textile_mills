import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  TrendingUp,
  ClipboardList,
  Sliders,
  Box,
  Layers,
  History,
  BarChart2,
  Users,
  Settings,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { useApp } from '../context/AppContext';

export default function Sidebar({ collapsed, onToggle }) {
  const { machines, inventory, orders } = useApp();

  const errorMachinesCount = machines ? machines.filter((m) => m.error).length : 0;
  const shortageCount = inventory ? inventory.filter((i) => i.shortage).length : 0;
  const qcFailedOrders = orders ? orders.filter((o) => o.status === 'Failed QC').length : 0;

  const menuItems = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    {
      to: '/orders',
      label: 'Manufacturing Orders',
      icon: TrendingUp,
      badge: qcFailedOrders > 0 ? `${qcFailedOrders}` : undefined,
      isErrorBadge: qcFailedOrders > 0,
    },
    { to: '/production', label: 'Work Orders', icon: ClipboardList },
    {
      to: '/machines',
      label: 'Work Centers',
      icon: Sliders,
      badge: errorMachinesCount > 0 ? `${errorMachinesCount}` : undefined,
      isErrorBadge: errorMachinesCount > 0,
    },
    {
      to: '/inventory',
      label: 'Inventory',
      icon: Box,
      badge: shortageCount > 0 ? `${shortageCount}` : undefined,
      isErrorBadge: shortageCount > 0,
    },
    { to: '/bom', label: 'BOM', icon: Layers },
    { to: '/ledger', label: 'Stock Ledger', icon: History },
    { to: '/reports', label: 'Reports', icon: BarChart2 },
    { to: '/analytics', label: 'Analytics', icon: TrendingUp },
    { to: '/users', label: 'Users', icon: Users },
    { to: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <aside className={`erp-sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Main Navigation">
      {/* Sidebar Top: "Menu" + collapse toggle `<` */}
      <div className="erp-sidebar-header">
        {!collapsed && <span className="erp-sidebar-title">Menu</span>}
        <button
          type="button"
          className="erp-sidebar-toggle-btn"
          onClick={onToggle}
          title={collapsed ? 'Expand Menu' : 'Collapse Menu'}
          aria-label={collapsed ? 'Expand Menu' : 'Collapse Menu'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      {/* Nav Menu */}
      <nav className="erp-sidebar-nav">
        {menuItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `erp-sidebar-item ${isActive ? 'active' : ''}`
              }
              title={collapsed ? item.label : undefined}
            >
              <Icon size={18} className="erp-nav-icon" />
              {!collapsed && (
                <>
                  <span className="erp-nav-label">{item.label}</span>
                  {item.badge && (
                    <span
                      className={`erp-nav-badge ${item.isErrorBadge ? 'error' : ''}`}
                    >
                      {item.isErrorBadge && <ShieldAlert size={11} style={{ marginRight: 2 }} />}
                      {item.badge}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
