import {
  Activity,
  BarChart2,
  Box,
  ShieldCheck,
  Receipt,
  ScrollText,
  Building2,
  Factory,
  ClipboardCheck,
  ClipboardList,
  History,
  Layers,
  LayoutDashboard,
  Settings,
  Shirt,
  Sliders,
  TrendingUp,
  Truck,
  Users,
} from 'lucide-react';

// Roles exactly as defined by the backend (backend/README.md permission matrix).
export const ROLES = Object.freeze({
  ADMIN: 'ADMIN',
  STORE_KEEPER: 'STORE_KEEPER',
  FLOOR_MANAGER: 'FLOOR_MANAGER',
  QC_INSPECTOR: 'QC_INSPECTOR',
  BUYER: 'BUYER',
});

const ALL = Object.values(ROLES);

export const ROLE_LABELS = Object.freeze({
  ADMIN: 'Admin / Owner',
  STORE_KEEPER: 'Store Keeper',
  FLOOR_MANAGER: 'Floor Manager',
  QC_INSPECTOR: 'QC Inspector',
  BUYER: 'Buyer',
});

/*
 * What the UI offers each role. This mirrors the backend permission matrix so people are not shown
 * buttons that would fail — it is NOT the security boundary. The backend checks every request
 * (authorize + ownership), and the RBAC matrix test proves it.
 */
export const can = {
  createOrder: (role) => role === ROLES.BUYER || role === ROLES.ADMIN,
  cancelOrder: (role) => role === ROLES.BUYER || role === ROLES.ADMIN,
  rejectOrder: (role) => role === ROLES.ADMIN,
  confirmOrder: (role) => role === ROLES.ADMIN,
  // Ownership is checked by the server (a buyer only ever receives their own orders).
  editOrder: (role) => role === ROLES.BUYER || role === ROLES.ADMIN,
  // Phase 4: the store moves yarn; the floor manager can see where it is.
  reserveMaterial: (role) => role === ROLES.STORE_KEEPER || role === ROLES.ADMIN,
  issueMaterial: (role) => role === ROLES.STORE_KEEPER || role === ROLES.ADMIN,
  viewReservations: (role) => [ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.ADMIN].includes(role),
  // Phase 7: the owner registers machines; the floor manager runs maintenance and reports problems.
  manageMachines: (role) => role === ROLES.ADMIN,
  operateMachines: (role) => role === ROLES.FLOOR_MANAGER || role === ROLES.ADMIN,
  // Phase 8: the floor manager plans and runs production; the store and QC follow it.
  runProduction: (role) => role === ROLES.FLOOR_MANAGER || role === ROLES.ADMIN,
  viewProduction: (role) => [ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.ADMIN].includes(role),
  // Phases 9-10: QC inspects (and signs passes); the floor finishes rework.
  inspectRolls: (role) => role === ROLES.QC_INSPECTOR || role === ROLES.ADMIN,
  finishRework: (role) => role === ROLES.FLOOR_MANAGER || role === ROLES.ADMIN,
  // Phases 11-12: the store dispatches (signed); the owner invoices; buyers read their own invoices.
  dispatchGoods: (role) => role === ROLES.STORE_KEEPER || role === ROLES.ADMIN,
  issueInvoice: (role) => role === ROLES.ADMIN,
  viewFeasibility: (role) => [ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.ADMIN].includes(role),
  manageBuyers: (role) => role === ROLES.ADMIN,
  manageProducts: (role) => role === ROLES.ADMIN,
  manageUsers: (role) => role === ROLES.ADMIN,
  viewStock: (role) => [ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.ADMIN].includes(role),
  receiveYarn: (role) => role === ROLES.STORE_KEEPER || role === ROLES.ADMIN,
  adjustStock: (role) => role === ROLES.ADMIN,
  reconcileStock: (role) => role === ROLES.ADMIN,
};

/** Screens connected to the real backend. */
export const LIVE_NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, roles: ALL },
  { to: '/orders', label: 'Orders', buyerLabel: 'My Orders', icon: ClipboardList, roles: ALL },
  { to: '/products', label: 'Fabric Catalog', icon: Shirt, roles: ALL },
  { to: '/buyers', label: 'Buyers', icon: Building2, roles: [ROLES.ADMIN] },
  { to: '/inventory', label: 'Yarn Inventory', icon: Box, roles: [ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.ADMIN] },
  { to: '/production', label: 'Production', icon: Activity, roles: [ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.ADMIN] },
  { to: '/dispatch', label: 'Dispatch', icon: Truck, roles: [ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.ADMIN] },
  { to: '/invoices', label: 'Invoices', icon: Receipt, roles: [ROLES.ADMIN, ROLES.BUYER] },
  { to: '/quality', label: 'Quality control', icon: ClipboardCheck, roles: [ROLES.QC_INSPECTOR, ROLES.FLOOR_MANAGER, ROLES.ADMIN] },
  { to: '/rolls', label: 'Rolls', icon: ScrollText, roles: [ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.ADMIN] },
  { to: '/machines', label: 'Machines', icon: Factory, roles: [ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.ADMIN] },
  { to: '/audit', label: 'Audit trail', icon: ShieldCheck, roles: [ROLES.STORE_KEEPER, ROLES.FLOOR_MANAGER, ROLES.QC_INSPECTOR, ROLES.ADMIN] },
  { to: '/users', label: 'Users', icon: Users, roles: [ROLES.ADMIN] },
];

/**
 * Screens that exist in the UI with SAMPLE data only; their backend modules are planned phases
 * (docs/PROGRESS.md). They are labelled as previews everywhere so nobody mistakes them for live data.
 */
export const PREVIEW_NAV = [
  { to: '/floor-map', label: 'Factory Floor Map', icon: Sliders, roles: [ROLES.ADMIN, ROLES.FLOOR_MANAGER], phase: 'Sample layout; live machines are under Machines' },
  { to: '/production-board', label: 'Production board', icon: Activity, roles: [ROLES.ADMIN, ROLES.FLOOR_MANAGER], phase: 'Sample board; live runs are under Production' },
  { to: '/quality-board', label: 'QC board', icon: ClipboardCheck, roles: [ROLES.ADMIN, ROLES.QC_INSPECTOR], phase: 'Sample board; live QC is under Quality control' },
  { to: '/dispatch-board', label: 'Dispatch board', icon: Truck, roles: [ROLES.ADMIN, ROLES.STORE_KEEPER], phase: 'Sample board; live dispatch is under Dispatch' },
  { to: '/bom', label: 'BOM', icon: Layers, roles: [ROLES.ADMIN], phase: 'Superseded by the Fabric Catalog' },
  { to: '/ledger', label: 'Stock Ledger', icon: History, roles: [ROLES.ADMIN], phase: 'Live per-lot ledger is in Yarn Inventory' },
  { to: '/reports', label: 'Reports', icon: BarChart2, roles: [ROLES.ADMIN], phase: 'Phase 14 — Costing' },
  { to: '/analytics', label: 'Analytics', icon: TrendingUp, roles: [ROLES.ADMIN], phase: 'Phase 17 — Intelligence' },
  { to: '/settings', label: 'Settings', icon: Settings, roles: [ROLES.ADMIN], phase: 'Not scheduled' },
];

export function navFor(role) {
  return {
    live: LIVE_NAV.filter((item) => item.roles.includes(role)),
    preview: PREVIEW_NAV.filter((item) => item.roles.includes(role)),
  };
}
