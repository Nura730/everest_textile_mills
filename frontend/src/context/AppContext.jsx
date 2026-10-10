import { createContext, useContext, useState, useMemo } from 'react';
import {
  initialOrders,
  initialInventory,
  initialMachines,
  initialQC,
  initialStockLedger,
  initialDispatches,
  initialAuditTrail,
  userRoles,
  boms,
  intelligenceAlerts as initialAlerts,
} from '../data/mockData';

const AppContext = createContext(null);

const defaultNotifications = [
  {
    id: 'notif-1',
    type: 'SUCCESS',
    title: 'Work Order WO-1006 Completed',
    message: '5,704 meters of Bamboo Blend Jersey completed and transferred to QC.',
    timestamp: '10 mins ago',
    unread: true,
    link: '/production',
  },
  {
    id: 'notif-2',
    type: 'WARNING',
    title: 'Machine Idle Warning',
    message: 'Machine W-03 (Rapier Loom A-03) has been idle for 18 minutes awaiting beam creeling.',
    timestamp: '24 mins ago',
    unread: true,
    link: '/machines',
  },
  {
    id: 'notif-3',
    type: 'CRITICAL',
    title: 'Order Deadline Risk',
    message: 'Order #ORD-2410-001 (12,000m Twill) is at high risk of missing deadline. QC inspection pending.',
    timestamp: '1 hour ago',
    unread: true,
    link: '/orders',
  },
  {
    id: 'notif-4',
    type: 'INFO',
    title: 'Inventory Synchronization Completed',
    message: 'Inventory check completed. All warehouse buffer stocks verified and recorded.',
    timestamp: '2 hours ago',
    unread: false,
    link: '/inventory',
  },
  {
    id: 'notif-5',
    type: 'CRITICAL',
    title: 'Machine Breakdown Detected',
    message: 'Dobby Loom C-05 (WV-16) halted due to warp stop motion trigger on harness shaft #4.',
    timestamp: '3 hours ago',
    unread: true,
    link: '/machines',
  },
];

export function AppProvider({ children }) {
  const [currentRole, setCurrentRole] = useState(userRoles[0]); // ADMIN_OWNER
  const [orders, setOrders] = useState(initialOrders);
  const [inventory, setInventory] = useState(initialInventory);
  const [machines, setMachines] = useState(initialMachines);
  const [qcInspections, setQcInspections] = useState(initialQC);
  const [stockLedger, setStockLedger] = useState(initialStockLedger);
  const [dispatches, setDispatches] = useState(initialDispatches);
  const [auditTrail, setAuditTrail] = useState(initialAuditTrail);
  const [alerts, setAlerts] = useState(initialAlerts);
  const [isOffline, setIsOffline] = useState(false);
  const [pendingSyncQueue, setPendingSyncQueue] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [notifications, setNotifications] = useState(defaultNotifications);

  // Global Toast Dispatcher
  const addToast = ({ type = 'info', title, message, duration = 4000 }) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newToast = { id, type, title, message, timestamp: Date.now() };
    setToasts((prev) => [...prev, newToast]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
    return id;
  };

  const removeToast = (id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const toast = useMemo(
    () => ({
      success: (message, title = 'Success') => addToast({ type: 'success', title, message }),
      error: (message, title = 'Error') => addToast({ type: 'error', title, message }),
      warning: (message, title = 'Warning') => addToast({ type: 'warning', title, message }),
      info: (message, title = 'Information') => addToast({ type: 'info', title, message }),
    }),
    []
  );

  // Notification management
  const markNotificationAsRead = (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, unread: false } : n))
    );
  };

  const markAllNotificationsAsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, unread: false })));
    toast.info('All notifications marked as read.');
  };

  const clearAllNotifications = () => {
    setNotifications([]);
    toast.info('Notification history cleared.');
  };

  // Append-only audit logger
  const logAudit = (action, details, orderId = '—', entityId = '—') => {
    const newEvent = {
      id: `AUD-${Date.now().toString().slice(-4)}`,
      action,
      actorId: currentRole.code,
      actorName: currentRole.name,
      actorRole: currentRole.id,
      orderId,
      entityId,
      timestamp: new Date().toISOString().replace('T', ' ').slice(0, 19),
      details,
      source: isOffline ? 'OFFLINE_CACHE' : 'ONLINE',
    };

    setAuditTrail((prev) => [newEvent, ...prev]);

    if (isOffline) {
      setPendingSyncQueue((prev) => [
        ...prev,
        { txnId: `LOCAL-TXN-${Math.random().toString(36).substring(2, 9)}`, event: newEvent },
      ]);
    }
  };

  // Section 5: Order Feasibility Engine
  const checkFeasibility = (fabricName, meters, deadlineDate) => {
    const bom = boms.find((b) => b.fabric === fabricName) || boms[0];
    const yarnPerMeter = bom.yarnPerMeter || 0.17;
    const requiredYarnKg = Math.round(meters * yarnPerMeter);

    // Find yarn in inventory
    const yarnItem = inventory.find((i) => i.name === bom.yarn || i.category === 'Yarn') || inventory[0];
    const availableYarn = yarnItem.availableStock;
    const hasEnoughYarn = availableYarn >= requiredYarnKg;

    // Check machine capacity
    // Standard speed: ~40 m/hr -> 40 * 20 operating hrs/day = 800 m/day
    const dailyCapacity = 800;
    const productionDaysNeeded = Math.ceil(meters / dailyCapacity);

    // Check deadline days
    const today = new Date();
    const targetDate = new Date(deadlineDate);
    const deadlineDays = Math.max(1, Math.ceil((targetDate - today) / (1000 * 60 * 60 * 24)));

    const hasEnoughTime = deadlineDays >= productionDaysNeeded;

    // Check suitable machine availability
    const suitableMachines = machines.filter(
      (m) => (m.status === 'Running' || m.status === 'Idle') && !m.error
    );
    const hasMachine = suitableMachines.length > 0;

    const reasons = [];
    if (!hasEnoughYarn) {
      reasons.push(
        `Material Shortage: Requires ${requiredYarnKg.toLocaleString()} kg of ${yarnItem.name}, but only ${availableYarn.toLocaleString()} kg available (${(requiredYarnKg - availableYarn).toLocaleString()} kg deficit).`
      );
    } else {
      reasons.push(
        `Material Available: ${requiredYarnKg.toLocaleString()} kg of ${yarnItem.name} can be reserved immediately from ${availableYarn.toLocaleString()} kg available.`
      );
    }

    if (!hasEnoughTime) {
      reasons.push(
        `Schedule Bottleneck: Production of ${meters.toLocaleString()}m requires ~${productionDaysNeeded} days at standard operating rate, but target deadline is in ${deadlineDays} day(s).`
      );
    } else {
      reasons.push(
        `Timeline Valid: ~${productionDaysNeeded} days required against ${deadlineDays} days available buffer.`
      );
    }

    if (!hasMachine) {
      reasons.push('Machine Capacity: All suitable looms are currently assigned or halted under maintenance.');
    } else {
      reasons.push(`Machine Fleet: ${suitableMachines.length} suitable looms available for immediate allocation.`);
    }

    const isFeasible = hasEnoughYarn && hasEnoughTime && hasMachine;

    return {
      isFeasible,
      score: isFeasible ? 95 : 45,
      requiredYarnKg,
      yarnName: yarnItem.name,
      availableYarn,
      productionDaysNeeded,
      deadlineDays,
      assignedLoom: suitableMachines[0]?.name || 'Loom A-03',
      reasons,
    };
  };

  // Create new manufacturing order
  const createOrder = (newOrder) => {
    const orderId = `ORD-2410-${String(orders.length + 1).padStart(3, '0')}`;
    const bom = boms.find((b) => b.fabric === newOrder.fabric) || boms[0];
    const yarnPerMeter = bom.yarnPerMeter || 0.17;
    const requiredYarnKg = Math.round(newOrder.quantity * yarnPerMeter);

    // Reserve stock in inventory
    setInventory((prev) =>
      prev.map((item) => {
        if (item.name === bom.yarn) {
          const reserved = item.reservedStock + requiredYarnKg;
          const available = Math.max(0, item.totalStock - reserved);
          return {
            ...item,
            reservedStock: reserved,
            availableStock: available,
            shortage: available < item.minStock,
          };
        }
        return item;
      })
    );

    const created = {
      id: orderId,
      customer: newOrder.customer,
      fabric: newOrder.fabric,
      quantity: Number(newOrder.quantity),
      unit: 'm',
      deadline: newOrder.deadline,
      status: 'Pending',
      state: 'MATERIAL_RESERVED',
      progress: 0,
      yarnRequired: `${bom.yarn} (${requiredYarnKg.toLocaleString()} kg)`,
      machine: newOrder.machine || 'Rapier Loom A-03',
      cost: {
        revenue: Math.round(newOrder.quantity * 140),
        material: Math.round(requiredYarnKg * 340),
        labour: Math.round(newOrder.quantity * 20),
        machine: Math.round(newOrder.quantity * 14),
        rework: 0,
        profit: Math.round(newOrder.quantity * 38),
        margin: 27.1,
      },
      timeline: [
        { step: 'ORDER_CREATED', label: 'Order Confirmed', date: new Date().toISOString().slice(0, 10), done: true },
        { step: 'MATERIAL_RESERVED', label: 'Material Reserved', date: new Date().toISOString().slice(0, 10), done: true },
        { step: 'PRODUCTION_STARTED', label: 'Production Scheduled', date: 'Est. Next Shift', current: true },
        { step: 'QC_PENDING', label: 'QC Inspection', date: 'Pending', done: false },
        { step: 'READY_FOR_DISPATCH', label: 'Ready for Dispatch', date: 'Pending', done: false },
        { step: 'DISPATCHED', label: 'Dispatched', date: 'Pending', done: false },
      ],
    };

    setOrders((prev) => [created, ...prev]);
    logAudit(
      'ORDER_CREATED',
      `Created order ${orderId} for ${newOrder.customer} (${newOrder.quantity}m ${newOrder.fabric}). Reserved ${requiredYarnKg}kg yarn.`,
      orderId,
      orderId
    );

    // Global toast and notification
    toast.success(`Manufacturing Order ${orderId} created successfully for ${newOrder.customer}.`, 'MO Created');
    setNotifications((prev) => [
      {
        id: `notif-${Date.now()}`,
        type: 'SUCCESS',
        title: `New MO Created: ${orderId}`,
        message: `${newOrder.customer} — ${Number(newOrder.quantity).toLocaleString()}m ${newOrder.fabric} reserved.`,
        timestamp: 'Just now',
        unread: true,
        link: '/orders',
      },
      ...prev,
    ]);

    return created;
  };

  // Cancel manufacturing order with audit & confirmation
  const cancelOrder = (orderId, reason = 'Operator cancellation') => {
    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status: 'Cancelled', state: 'CANCELLED' } : o))
    );
    logAudit('ORDER_CANCELLED', `Order ${orderId} cancelled. Reason: ${reason}`, orderId, orderId);
    toast.warning(`Order ${orderId} has been cancelled.`, 'Order Cancelled');
  };

  // Report machine problem (Floor Manager)
  const reportMachineProblem = (machineId, { type, severity, description, pauseProduction }) => {
    setMachines((prev) =>
      prev.map((m) => {
        if (m.id === machineId) {
          return {
            ...m,
            status: pauseProduction ? `Halted — ${type}` : `Warning — ${type}`,
            rpm: pauseProduction ? 0 : m.rpm,
            speed: pauseProduction ? '0 m/hr' : m.speed,
            error: true,
            problem: {
              type,
              severity,
              description,
              reportedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
              reportedBy: `${currentRole.name} (${currentRole.title})`,
            },
          };
        }
        return m;
      })
    );

    // Intelligence Alert
    const targetMachine = machines.find((m) => m.id === machineId);
    if (targetMachine?.currentOrder && targetMachine.currentOrder !== '—') {
      const newAlert = {
        id: `RISK-${Date.now().toString().slice(-4)}`,
        orderId: targetMachine.currentOrder,
        level: severity === 'Critical' ? 'HIGH_RISK' : 'MEDIUM_RISK',
        title: `Machine Problem on ${targetMachine.name} affects ${targetMachine.currentOrder}`,
        reason: `${type} breakdown (${severity}): ${description}. Production throughput impacted.`,
        recommendation: 'Evaluate shifting remaining order volume to Loom A-03 (currently Idle).',
        actionRequired: 'Reroute to Loom A-03',
        timestamp: 'Just now',
      };
      setAlerts((prev) => [newAlert, ...prev]);
    }

    logAudit(
      'MACHINE_PROBLEM_REPORTED',
      `Reported ${severity} ${type} issue on ${machineId}: ${description}. Production ${pauseProduction ? 'halted' : 'monitored'}.`,
      targetMachine?.currentOrder || '—',
      machineId
    );
  };

  // Resolve machine problem
  const resolveMachineProblem = (machineId) => {
    setMachines((prev) =>
      prev.map((m) => {
        if (m.id === machineId) {
          return {
            ...m,
            status: 'Running',
            rpm: 520,
            speed: '40 m/hr',
            error: false,
            problem: null,
            lastMaintenance: new Date().toISOString().slice(0, 10),
          };
        }
        return m;
      })
    );

    logAudit('MACHINE_MAINTENANCE_RESOLVED', `Maintenance completed on ${machineId}. Restored to active running status.`, '—', machineId);
  };

  // Submit QC inspection with Digital Signature
  const submitQCInspection = ({ rollId, orderId, machineId, fabric, meters, result, defectType, notes, signature }) => {
    const inspectionId = `QC-${Date.now().toString().slice(-4)}`;
    const sigHash = `SIG-SHA256-${Math.random().toString(16).substring(2, 12)}`;

    const newQC = {
      id: inspectionId,
      rollId,
      orderId,
      machineId,
      fabric,
      meters: Number(meters),
      inspector: signature || currentRole.name,
      inspectorRole: currentRole.title,
      date: new Date().toISOString().slice(0, 10),
      result,
      error: result !== 'PASS',
      defectsPerHundred: result === 'PASS' ? 0.9 : 7.5,
      defectType: result === 'PASS' ? 'None' : defectType,
      notes,
      digitalSignature: sigHash,
      signedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };

    setQcInspections((prev) => [newQC, ...prev]);

    // If passed, move to Finished Goods Stock Ledger
    if (result === 'PASS') {
      const newLedgerItem = {
        rollId,
        orderId,
        customer: orders.find((o) => o.id === orderId)?.customer || 'Textile Client',
        fabric,
        meters: Number(meters),
        weightKg: Math.round(Number(meters) * 0.17),
        grade: 'A',
        qcStatus: 'PASS',
        location: `FG-Rack-${Math.floor(Math.random() * 15 + 1).toString().padStart(2, '0')}`,
        status: 'In Store',
        dispatchId: '—',
      };
      setStockLedger((prev) => [newLedgerItem, ...prev]);
    }

    // Update order status if needed
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id === orderId) {
          return {
            ...o,
            status: result === 'PASS' ? 'Quality Check' : 'Failed QC',
            state: result === 'PASS' ? 'QC_PASSED' : 'QC_REWORK',
          };
        }
        return o;
      })
    );

    logAudit(
      'QC_APPROVAL_SIGNED',
      `QC ${result} recorded for ${rollId} (${orderId}). Digitally signed: ${sigHash} by ${signature || currentRole.name}.`,
      orderId,
      rollId
    );
  };

  // Reserve yarn stock (Store Keeper)
  const reserveYarn = (materialId, amountKg, orderId) => {
    setInventory((prev) =>
      prev.map((item) => {
        if (item.id === materialId) {
          const reserved = item.reservedStock + Number(amountKg);
          const available = Math.max(0, item.totalStock - reserved);
          return {
            ...item,
            reservedStock: reserved,
            availableStock: available,
            shortage: available < item.minStock,
          };
        }
        return item;
      })
    );

    logAudit(
      'MATERIAL_RESERVED',
      `Reserved ${amountKg} kg of ${materialId} for order ${orderId}.`,
      orderId,
      materialId
    );
  };

  // Confirm Dispatch with Digital Signature
  const confirmDispatch = (dispatchId, { vehicle, driver, signature }) => {
    const sigHash = `SIG-DISP-${Math.random().toString(16).substring(2, 12)}`;
    const invoiceNum = `INV-ETM-${new Date().getFullYear()}-${Math.floor(Math.random() * 900 + 100)}`;

    setDispatches((prev) =>
      prev.map((d) => {
        if (d.id === dispatchId) {
          return {
            ...d,
            status: 'Shipped',
            vehicle: vehicle || d.vehicle,
            driver: driver || 'Assigned Driver',
            dispatchDate: new Date().toISOString().slice(0, 10),
            digitalSignature: sigHash,
            invoiceNumber: invoiceNum,
          };
        }
        return d;
      })
    );

    const targetDisp = dispatches.find((d) => d.id === dispatchId);
    if (targetDisp) {
      setOrders((prev) =>
        prev.map((o) => {
          if (o.id === targetDisp.order) {
            return {
              ...o,
              status: 'Dispatched',
              state: 'DISPATCH_CONFIRMED',
              progress: 100,
            };
          }
          return o;
        })
      );
    }

    logAudit(
      'DISPATCH_CONFIRMED',
      `Dispatch ${dispatchId} confirmed with signature ${sigHash}. Invoice ${invoiceNum} generated. Vehicle: ${vehicle}.`,
      targetDisp?.order || '—',
      dispatchId
    );
  };

  // Sync offline queue when back online
  const triggerSync = () => {
    const count = pendingSyncQueue.length;
    if (count > 0) {
      setPendingSyncQueue([]);
      logAudit(
        'OFFLINE_QUEUE_SYNCED',
        `Successfully synced ${count} offline transactions with central Mongo backend. Idempotency verified.`
      );
      toast.success(`Successfully synced ${count} offline transactions with Central ERP.`, 'Sync Complete');
    } else {
      toast.info('All transactions are already synchronized.', 'Live Synced');
    }
    setIsOffline(false);
  };

  const contextValue = useMemo(
    () => ({
      currentRole,
      setCurrentRole,
      roles: userRoles,
      orders,
      inventory,
      machines,
      qcInspections,
      stockLedger,
      dispatches,
      auditTrail,
      alerts,
      isOffline,
      setIsOffline,
      pendingSyncQueue,
      triggerSync,
      checkFeasibility,
      createOrder,
      cancelOrder,
      reportMachineProblem,
      resolveMachineProblem,
      submitQCInspection,
      reserveYarn,
      confirmDispatch,
      toasts,
      addToast,
      removeToast,
      toast,
      notifications,
      markNotificationAsRead,
      markAllNotificationsAsRead,
      clearAllNotifications,
    }),
    [
      currentRole,
      orders,
      inventory,
      machines,
      qcInspections,
      stockLedger,
      dispatches,
      auditTrail,
      alerts,
      isOffline,
      pendingSyncQueue,
      toasts,
      toast,
      notifications,
    ]
  );

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
