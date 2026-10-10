import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { useApp } from '../context/AppContext';
import Header from './Header';
import Sidebar from './Sidebar';

// The preview screens (sample data) read the role from the legacy AppContext. Keep it in step with
// the real signed-in role so those screens apply the same role rules as the rest of the app.
const PREVIEW_ROLE_ID = { ADMIN: 'ADMIN_OWNER' };

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();
  const { roles, setCurrentRole } = useApp();

  useEffect(() => {
    const previewRole = roles.find((role) => role.id === (PREVIEW_ROLE_ID[user.role] ?? user.role));
    if (previewRole) setCurrentRole({ ...previewRole, name: user.name });
  }, [user, roles, setCurrentRole]);

  return (
    <div className="erp-app-container">
      <Header onMenu={() => setMobileOpen((open) => !open)} menuOpen={mobileOpen} />
      <div className="erp-body-layout">
        {/* On small screens the menu is an overlay that closes when a link is chosen. */}
        <Sidebar collapsed={collapsed} mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)} onToggle={() => setCollapsed(!collapsed)} />
        {mobileOpen && <div className="mobile-backdrop" onClick={() => setMobileOpen(false)} aria-hidden="true" />}
        <main className={`erp-main-content ${collapsed ? 'sidebar-collapsed' : ''}`} id="main">
          <div className="erp-page-wrapper">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
