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
  const { machines, inventory, orders, currentRole } = useApp();

  const errorMachinesCount = machines.filter((m) => m.error).length;
  const shortageCount = inventory.filter((i) => i.shortage).length;
  const qcFailedOrders = orders.filter((o) => o.status === 'Failed QC').length;

  const isFloorMapAuthorized =
    currentRole && (currentRole.id === 'ADMIN_OWNER' || currentRole.id === 'FLOOR_MANAGER');

  const menuItems = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    {
      to: '/orders',
      label: 'Manufacturing Orders',
      icon: TrendingUp,
      badge: qcFailedOrders > 0 ? `${qcFailedOrders} alert` : undefined,
      isErrorBadge: qcFailedOrders > 0,
    },
    { to: '/production', label: 'Work Orders', icon: ClipboardList },
    ...(isFloorMapAuthorized
      ? [
          {
            to: '/machines',
            label: 'Factory Floor Map',
            icon: Sliders,
            badge: errorMachinesCount > 0 ? `${errorMachinesCount}` : undefined,
            isErrorBadge: errorMachinesCount > 0,
          },
        ]
      : []),
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
    <aside className={`erp-sidebar ${collapsed ? 'collapsed' : ''}`}>
      {/* Sidebar Top: "Menu" + collapse toggle `<` */}
      <div className="erp-sidebar-header">
        {!collapsed && <span className="erp-sidebar-title">Menu</span>}
        <button
          className="erp-sidebar-toggle-btn"
          onClick={onToggle}
          title={collapsed ? 'Expand Menu' : 'Collapse Menu'}
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
