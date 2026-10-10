import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Header from './Header';
import Sidebar from './Sidebar';
import ToastContainer from './ToastContainer';

export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="erp-app-container">
      {/* Top Header spans 100% width across the top */}
      <Header />

      {/* Main Body below header: Sidebar on Left, Content on Right */}
      <div className="erp-body-layout">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
        <main className={`erp-main-content ${collapsed ? 'sidebar-collapsed' : ''}`}>
          <div className="erp-page-wrapper">
            <Outlet />
          </div>
        </main>
      </div>

      {/* Global Toast Notification System */}
      <ToastContainer />
    </div>
  );
}
