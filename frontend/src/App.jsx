import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext.jsx';
import { RequireAuth, RequireRole } from './auth/RequireAuth.jsx';
import { LIVE_NAV, PREVIEW_NAV } from './auth/roles.js';
import AppLayout from './components/AppLayout';
import { PreviewNotice } from './components/ui/PageHeader.jsx';
import { ToastProvider } from './components/ui/Toast.jsx';
import { AppProvider } from './context/AppContext';
// Live screens (real backend data)
import Buyers from './pages/Buyers';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import MachineDetail from './pages/MachineDetail';
import MachineList from './pages/MachineList';
import ProductionList from './pages/ProductionList';
import QcQueue from './pages/QcQueue';
import RollDetail from './pages/RollDetail';
import RollList from './pages/RollList';
import RunDetail from './pages/RunDetail';
import Login from './pages/Login';
import OrderDetail from './pages/OrderDetail';
import Orders from './pages/Orders';
import Products from './pages/Products';
import Users from './pages/Users';
// Preview screens (sample data from context/AppContext; backend modules are planned phases)
import Analytics from './pages/Analytics';
import BOM from './pages/BOM';
import Dispatch from './pages/Dispatch';
import Machines from './pages/Machines';
import Production from './pages/Production';
import QualityControl from './pages/QualityControl';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import StockLedger from './pages/StockLedger';

const LIVE_PAGES = {
  '/dashboard': <Dashboard />,
  '/orders': <Orders />,
  '/products': <Products />,
  '/buyers': <Buyers />,
  '/inventory': <Inventory />,
  '/machines': <MachineList />,
  '/production': <ProductionList />,
  '/quality': <QcQueue />,
  '/rolls': <RollList />,
  '/users': <Users />,
};

const PREVIEW_PAGES = {
  '/floor-map': <Machines />,
  '/production-board': <Production />,
  '/quality-board': <QualityControl />,
  '/dispatch': <Dispatch />,
  '/bom': <BOM />,
  '/ledger': <StockLedger />,
  '/reports': <Reports />,
  '/analytics': <Analytics />,
  '/settings': <Settings />,
};

const ordersRoles = LIVE_NAV.find((item) => item.to === '/orders').roles;
const machineRoles = LIVE_NAV.find((item) => item.to === '/machines').roles;
const productionRoles = LIVE_NAV.find((item) => item.to === '/production').roles;
const rollRoles = LIVE_NAV.find((item) => item.to === '/rolls').roles;

function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<RequireAuth />}>
                <Route path="/" element={<AppLayout />}>
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  {LIVE_NAV.map((item) => (
                    <Route
                      key={item.to}
                      path={item.to.slice(1)}
                      element={<RequireRole roles={item.roles}>{LIVE_PAGES[item.to]}</RequireRole>}
                    />
                  ))}
                  <Route path="orders/:id" element={<RequireRole roles={ordersRoles}><OrderDetail /></RequireRole>} />
                  <Route path="machines/:id" element={<RequireRole roles={machineRoles}><MachineDetail /></RequireRole>} />
                  <Route path="production/:id" element={<RequireRole roles={productionRoles}><RunDetail /></RequireRole>} />
                  <Route path="rolls/:id" element={<RequireRole roles={rollRoles}><RollDetail /></RequireRole>} />
                  {PREVIEW_NAV.map((item) => (
                    <Route
                      key={item.to}
                      path={item.to.slice(1)}
                      element={
                        <RequireRole roles={item.roles}>
                          <PreviewNotice phase={item.phase}>{PREVIEW_PAGES[item.to]}</PreviewNotice>
                        </RequireRole>
                      }
                    />
                  ))}
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
        </AppProvider>
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
