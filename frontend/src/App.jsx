import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import AppLayout from './components/AppLayout';
import Dashboard from './pages/Dashboard';
import Orders from './pages/Orders';
import Production from './pages/Production';
import Inventory from './pages/Inventory';
import QualityControl from './pages/QualityControl';
import Machines from './pages/Machines';
import Dispatch from './pages/Dispatch';
import BOM from './pages/BOM';
import StockLedger from './pages/StockLedger';
import Reports from './pages/Reports';
import Analytics from './pages/Analytics';
import Users from './pages/Users';
import Settings from './pages/Settings';

function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="orders" element={<Orders />} />
            <Route path="production" element={<Production />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="bom" element={<BOM />} />
            <Route path="ledger" element={<StockLedger />} />
            <Route path="quality" element={<QualityControl />} />
            <Route path="machines" element={<Machines />} />
            <Route path="dispatch" element={<Dispatch />} />
            <Route path="reports" element={<Reports />} />
            <Route path="analytics" element={<Analytics />} />
            <Route path="users" element={<Users />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}

export default App;
