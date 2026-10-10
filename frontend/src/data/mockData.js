// ============================================
// TextileIQ — Mock Data
// Realistic textile manufacturing data
// ============================================

// -- Dashboard KPIs --
export const dashboardKPIs = {
  totalOrders: 187,
  activeProduction: 24,
  machineUtilization: '78%',
  pendingDispatch: 12,
  materialShortages: 3,
  qualityPassRate: '96.2%',
  dailyOutput: '4,820 m',
  costPerMeter: '₹142.30',
};

// -- Orders --
export const orders = [
  { id: 'ORD-2410-001', customer: 'Raymond Ltd.', fabric: 'Cotton Twill 2/1', quantity: '12,000 m', deadline: '2026-10-18', status: 'In Production', progress: 65 },
  { id: 'ORD-2410-002', customer: 'Arvind Mills', fabric: 'Polyester Satin', quantity: '8,500 m', deadline: '2026-10-22', status: 'In Production', progress: 42 },
  { id: 'ORD-2410-003', customer: 'Welspun India', fabric: 'Organic Cotton Plain', quantity: '20,000 m', deadline: '2026-10-30', status: 'Pending', progress: 0 },
  { id: 'ORD-2410-004', customer: 'Trident Group', fabric: 'Bamboo Blend Jersey', quantity: '6,200 m', deadline: '2026-10-15', status: 'Quality Check', progress: 92 },
  { id: 'ORD-2410-005', customer: 'Vardhman Textiles', fabric: 'Viscose Crepe', quantity: '15,000 m', deadline: '2026-10-25', status: 'In Production', progress: 28 },
  { id: 'ORD-2410-006', customer: 'Grasim Industries', fabric: 'Linen Chambray', quantity: '4,000 m', deadline: '2026-10-12', status: 'Dispatched', progress: 100 },
  { id: 'ORD-2410-007', customer: 'Bombay Dyeing', fabric: 'Cotton Dobby', quantity: '9,800 m', deadline: '2026-10-20', status: 'In Production', progress: 55 },
  { id: 'ORD-2410-008', customer: 'Page Industries', fabric: 'Cotton Interlock Knit', quantity: '11,400 m', deadline: '2026-10-28', status: 'Pending', progress: 0 },
  { id: 'ORD-2410-009', customer: 'RSWM Ltd.', fabric: 'Polyester Twill', quantity: '7,600 m', deadline: '2026-10-14', status: 'Failed QC', progress: 88 },
  { id: 'ORD-2410-010', customer: 'Donear Industries', fabric: 'Wool Blend Suiting', quantity: '3,200 m', deadline: '2026-10-16', status: 'In Production', progress: 72 },
];

// -- Production Runs --
export const productionRuns = [
  { id: 'PR-1001', order: 'ORD-2410-001', machine: 'Loom A-12', fabric: 'Cotton Twill 2/1', targetQty: '12,000 m', completedQty: '7,800 m', speed: '42 m/hr', status: 'Running', shift: 'Day', operator: 'Rajesh K.' },
  { id: 'PR-1002', order: 'ORD-2410-002', machine: 'Loom B-04', fabric: 'Polyester Satin', targetQty: '8,500 m', completedQty: '3,570 m', speed: '38 m/hr', status: 'Running', shift: 'Day', operator: 'Suresh M.' },
  { id: 'PR-1003', order: 'ORD-2410-005', machine: 'Loom A-08', fabric: 'Viscose Crepe', targetQty: '15,000 m', completedQty: '4,200 m', speed: '35 m/hr', status: 'Running', shift: 'Day', operator: 'Amit P.' },
  { id: 'PR-1004', order: 'ORD-2410-007', machine: 'Loom C-02', fabric: 'Cotton Dobby', targetQty: '9,800 m', completedQty: '5,390 m', speed: '40 m/hr', status: 'Running', shift: 'Night', operator: 'Vikram S.' },
  { id: 'PR-1005', order: 'ORD-2410-010', machine: 'Loom B-07', fabric: 'Wool Blend Suiting', targetQty: '3,200 m', completedQty: '2,304 m', speed: '28 m/hr', status: 'Running', shift: 'Day', operator: 'Manoj T.' },
  { id: 'PR-1006', order: 'ORD-2410-004', machine: 'Loom A-03', fabric: 'Bamboo Blend Jersey', targetQty: '6,200 m', completedQty: '5,704 m', speed: '0 m/hr', status: 'Completed', shift: '—', operator: 'Deepak R.' },
  { id: 'PR-1007', order: 'ORD-2410-009', machine: 'Loom C-05', fabric: 'Polyester Twill', targetQty: '7,600 m', completedQty: '6,688 m', speed: '0 m/hr', status: 'Halted — QC Failure', shift: '—', operator: 'Sanjay G.' },
];

// -- Inventory --
export const inventoryItems = [
  { id: 'MAT-001', name: 'Cotton Yarn 40s Ne', category: 'Yarn', unit: 'kg', stock: 2800, minStock: 1000, location: 'Store A', lastRestocked: '2026-10-05' },
  { id: 'MAT-002', name: 'Polyester Filament 75D', category: 'Yarn', unit: 'kg', stock: 1450, minStock: 500, location: 'Store A', lastRestocked: '2026-10-03' },
  { id: 'MAT-003', name: 'Viscose Staple Fiber', category: 'Fiber', unit: 'kg', stock: 120, minStock: 800, location: 'Store B', lastRestocked: '2026-09-20', shortage: true },
  { id: 'MAT-004', name: 'Reactive Dye — Black', category: 'Dye', unit: 'kg', stock: 85, minStock: 100, location: 'Chemical Store', lastRestocked: '2026-10-01', shortage: true },
  { id: 'MAT-005', name: 'Sizing Agent PVA', category: 'Chemical', unit: 'L', stock: 340, minStock: 200, location: 'Chemical Store', lastRestocked: '2026-10-07' },
  { id: 'MAT-006', name: 'Wool Yarn 2/48 Nm', category: 'Yarn', unit: 'kg', stock: 680, minStock: 300, location: 'Store C', lastRestocked: '2026-10-04' },
  { id: 'MAT-007', name: 'Bamboo Viscose Yarn', category: 'Yarn', unit: 'kg', stock: 55, minStock: 400, location: 'Store B', lastRestocked: '2026-09-15', shortage: true },
  { id: 'MAT-008', name: 'Softener Finish Agent', category: 'Chemical', unit: 'L', stock: 520, minStock: 150, location: 'Chemical Store', lastRestocked: '2026-10-08' },
  { id: 'MAT-009', name: 'Linen Yarn 20 Lea', category: 'Yarn', unit: 'kg', stock: 1100, minStock: 400, location: 'Store A', lastRestocked: '2026-10-02' },
  { id: 'MAT-010', name: 'Warp Beam Steel Core', category: 'Parts', unit: 'pcs', stock: 24, minStock: 10, location: 'Maintenance Store', lastRestocked: '2026-09-28' },
];

// -- Machines --
export const machines = [
  { id: 'MCH-A03', name: 'Rapier Loom A-03', type: 'Weaving', status: 'Idle', rpm: 0, efficiency: '—', lastMaintenance: '2026-10-02', nextMaintenance: '2026-10-17', uptime: '94.2%' },
  { id: 'MCH-A08', name: 'Rapier Loom A-08', type: 'Weaving', status: 'Running', rpm: 520, efficiency: '91%', lastMaintenance: '2026-09-28', nextMaintenance: '2026-10-13', uptime: '96.1%' },
  { id: 'MCH-A12', name: 'Rapier Loom A-12', type: 'Weaving', status: 'Running', rpm: 540, efficiency: '93%', lastMaintenance: '2026-10-01', nextMaintenance: '2026-10-16', uptime: '97.0%' },
  { id: 'MCH-B04', name: 'Air Jet Loom B-04', type: 'Weaving', status: 'Running', rpm: 680, efficiency: '88%', lastMaintenance: '2026-09-25', nextMaintenance: '2026-10-10', uptime: '89.3%' },
  { id: 'MCH-B07', name: 'Air Jet Loom B-07', type: 'Weaving', status: 'Running', rpm: 450, efficiency: '85%', lastMaintenance: '2026-09-30', nextMaintenance: '2026-10-15', uptime: '91.5%' },
  { id: 'MCH-C02', name: 'Dobby Loom C-02', type: 'Weaving', status: 'Running', rpm: 480, efficiency: '90%', lastMaintenance: '2026-10-03', nextMaintenance: '2026-10-18', uptime: '95.4%' },
  { id: 'MCH-C05', name: 'Dobby Loom C-05', type: 'Weaving', status: 'Error — Warp Break', rpm: 0, efficiency: '—', lastMaintenance: '2026-09-22', nextMaintenance: '2026-10-07', uptime: '72.8%', error: true },
  { id: 'MCH-D01', name: 'Sizing Machine D-01', type: 'Preparation', status: 'Running', rpm: 120, efficiency: '95%', lastMaintenance: '2026-10-05', nextMaintenance: '2026-10-20', uptime: '98.2%' },
  { id: 'MCH-E01', name: 'Inspection Frame E-01', type: 'Quality', status: 'Running', rpm: '—', efficiency: '—', lastMaintenance: '2026-10-06', nextMaintenance: '2026-10-21', uptime: '99.1%' },
  { id: 'MCH-F01', name: 'Stenter Frame F-01', type: 'Finishing', status: 'Idle', rpm: 0, efficiency: '—', lastMaintenance: '2026-10-04', nextMaintenance: '2026-10-19', uptime: '93.0%' },
];

// -- Quality Control --
export const qualityInspections = [
  { id: 'QC-5001', order: 'ORD-2410-004', fabric: 'Bamboo Blend Jersey', inspector: 'Mohan V.', date: '2026-10-10', result: 'Pass', defectsPerHundred: 1.2, notes: 'Minor edge variation. Acceptable.' },
  { id: 'QC-5002', order: 'ORD-2410-009', fabric: 'Polyester Twill', inspector: 'Kavita S.', date: '2026-10-10', result: 'Fail', defectsPerHundred: 8.7, notes: 'Weft bar defect across 120m section. Requires rework.', error: true },
  { id: 'QC-5003', order: 'ORD-2410-001', fabric: 'Cotton Twill 2/1', inspector: 'Mohan V.', date: '2026-10-09', result: 'Pass', defectsPerHundred: 0.8, notes: 'Consistent quality.' },
  { id: 'QC-5004', order: 'ORD-2410-006', fabric: 'Linen Chambray', inspector: 'Kavita S.', date: '2026-10-08', result: 'Pass', defectsPerHundred: 1.5, notes: 'Approved for dispatch.' },
  { id: 'QC-5005', order: 'ORD-2410-002', fabric: 'Polyester Satin', inspector: 'Priya T.', date: '2026-10-09', result: 'Pass', defectsPerHundred: 0.4, notes: 'Excellent finish quality.' },
  { id: 'QC-5006', order: 'ORD-2410-007', fabric: 'Cotton Dobby', inspector: 'Mohan V.', date: '2026-10-08', result: 'Pass', defectsPerHundred: 2.1, notes: 'Slight pilling tendency noted. Within tolerance.' },
];

// -- Dispatch --
export const dispatches = [
  { id: 'DSP-3001', order: 'ORD-2410-006', customer: 'Grasim Industries', fabric: 'Linen Chambray', quantity: '4,000 m', status: 'Shipped', vehicle: 'MH-12-AB-3456', dispatchDate: '2026-10-09', eta: '2026-10-11' },
  { id: 'DSP-3002', order: 'ORD-2410-004', customer: 'Trident Group', fabric: 'Bamboo Blend Jersey', quantity: '6,200 m', status: 'Packing', vehicle: '—', dispatchDate: '—', eta: '2026-10-12' },
  { id: 'DSP-3003', order: 'ORD-2410-001', customer: 'Raymond Ltd.', fabric: 'Cotton Twill 2/1', quantity: '12,000 m', status: 'Awaiting QC', vehicle: '—', dispatchDate: '—', eta: '2026-10-19' },
  { id: 'DSP-3004', order: 'ORD-2410-010', customer: 'Donear Industries', fabric: 'Wool Blend Suiting', quantity: '3,200 m', status: 'Awaiting QC', vehicle: '—', dispatchDate: '—', eta: '2026-10-17' },
  { id: 'DSP-3005', order: 'ORD-2410-002', customer: 'Arvind Mills', fabric: 'Polyester Satin', quantity: '8,500 m', status: 'Not Started', vehicle: '—', dispatchDate: '—', eta: '2026-10-23' },
];

// -- Production Chart Data --
export const weeklyOutputData = [
  { day: 'Mon', output: 4200 },
  { day: 'Tue', output: 4680 },
  { day: 'Wed', output: 4520 },
  { day: 'Thu', output: 4890 },
  { day: 'Fri', output: 4820 },
  { day: 'Sat', output: 3100 },
  { day: 'Sun', output: 0 },
];

export const monthlyOutputData = [
  { week: 'W1', output: 22400 },
  { week: 'W2', output: 24100 },
  { week: 'W3', output: 21800 },
  { week: 'W4', output: 23600 },
];

export const machineUtilizationData = [
  { name: 'Loom A-08', utilization: 96 },
  { name: 'Loom A-12', utilization: 97 },
  { name: 'Loom B-04', utilization: 89 },
  { name: 'Loom B-07', utilization: 91 },
  { name: 'Loom C-02', utilization: 95 },
  { name: 'Loom C-05', utilization: 73 },
  { name: 'Sizing D-01', utilization: 98 },
  { name: 'Inspect E-01', utilization: 99 },
];

export const defectTrendData = [
  { month: 'May', rate: 3.2 },
  { month: 'Jun', rate: 2.8 },
  { month: 'Jul', rate: 2.5 },
  { month: 'Aug', rate: 2.9 },
  { month: 'Sep', rate: 2.1 },
  { month: 'Oct', rate: 1.8 },
];

// -- Recent Activity --
export const recentActivity = [
  { type: 'production', text: 'Production run PR-1001 reached 65% completion on Loom A-12.', time: '12 min ago' },
  { type: 'quality', text: 'QC inspection QC-5002 failed for order ORD-2410-009. Weft bar defect.', time: '28 min ago', error: true },
  { type: 'inventory', text: 'Viscose Staple Fiber stock critically low — 120 kg remaining (min: 800 kg).', time: '1 hr ago', error: true },
  { type: 'dispatch', text: 'Dispatch DSP-3001 shipped to Grasim Industries. Vehicle MH-12-AB-3456.', time: '2 hr ago' },
  { type: 'machine', text: 'Dobby Loom C-05 halted — warp break detected. Maintenance dispatched.', time: '3 hr ago', error: true },
  { type: 'order', text: 'New order ORD-2410-010 received from Donear Industries — Wool Blend Suiting, 3,200 m.', time: '4 hr ago' },
  { type: 'production', text: 'Production run PR-1006 completed for Bamboo Blend Jersey. Sent to QC.', time: '5 hr ago' },
  { type: 'inventory', text: 'Reactive Dye — Black restocked to 85 kg. Still below minimum (100 kg).', time: '6 hr ago', error: true },
];

// -- Cost Data --
export const costBreakdown = [
  { category: 'Raw Material', amount: 684000, percentage: 48 },
  { category: 'Labour', amount: 285000, percentage: 20 },
  { category: 'Energy', amount: 199500, percentage: 14 },
  { category: 'Maintenance', amount: 114000, percentage: 8 },
  { category: 'Overheads', amount: 142500, percentage: 10 },
];
