import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Box, Building2, CheckCircle2, ClipboardList, Factory, FlaskConical, Plus, Shirt, Users as UsersIcon } from 'lucide-react';
import { buyersApi, inventoryApi, machinesApi, ordersApi, productsApi, rollsApi, usersApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { PREVIEW_NAV, ROLES, ROLE_LABELS, SHOW_SAMPLE_SCREENS } from '../auth/roles.js';
import { OperationalInsights } from '../attention/OperationalInsights.jsx';
import { CreateOrderModal } from '../components/orders/CreateOrderModal.jsx';
import { DeadlineChip, OrderProgress, OrderStatusBadge } from '../components/ui/OrderStatus.jsx';
import { isOpenOrder } from '../utils/orderStatus.js';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { StatusBadge } from '../components/ui/StatusBadge.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { daysUntil, formatDate, formatNumber, formatPaise } from '../utils/format.js';

// ── Building blocks ──────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, icon: Icon, to, alert = false }) {
  const content = (
    <>
      <div className="tall-kpi-header">
        <span className="tall-kpi-label">{label}</span>
        {Icon && <Icon size={16} className="tall-kpi-icon" aria-hidden="true" />}
      </div>
      <div className={`tall-kpi-value ${alert ? 'text-red' : ''}`}>{value ?? '…'}</div>
      {sub && <div className="tall-kpi-subtext">{sub}</div>}
    </>
  );
  return to ? <Link to={to} className="erp-tall-kpi-card kpi-link">{content}</Link> : <div className="erp-tall-kpi-card">{content}</div>;
}

/** Loads several endpoints together; any failure shows one error with a retry. */
function useDashboardData(loaders) {
  return useApiQuery(async () => {
    const entries = await Promise.all(Object.entries(loaders).map(async ([key, load]) => [key, await load()]));
    return { data: Object.fromEntries(entries) };
  }, []);
}

/*
 * Orders still ahead of production: awaiting a decision (ORDER_CREATED) or confirmed and waiting for
 * yarn (CONFIRMED). Both need yarn and floor time. The list API filters by one status, so the two
 * lists are fetched and merged.
 */
const PIPELINE_STATUSES = ['ORDER_CREATED', 'CONFIRMED'];
async function loadPipelineOrders() {
  const pages = await Promise.all(PIPELINE_STATUSES.map((status) => ordersApi.list({ status, limit: 100 })));
  return { data: { orders: pages.flatMap((page) => page.data.orders) } };
}

/** Orders with yarn already reserved: ready for the floor (and already counted in reserved stock). */
const loadReservedOrders = () => ordersApi.list({ status: 'MATERIAL_RESERVED', limit: 100 });

const byDeadline = (a, b) => a.requiredBy.localeCompare(b.requiredBy);
const overdueOrDueSoon = (orders) => orders.filter((order) => isOpenOrder(order) && daysUntil(order.requiredBy) <= 7);

function OpenOrdersTable({ orders, showBuyer, showYarn, emptyText }) {
  if (orders.length === 0) return <EmptyState title="Nothing waiting">{emptyText}</EmptyState>;
  return (
    <div className="erp-table-wrapper">
      <table className="erp-data-table">
        <thead>
          <tr>
            <th scope="col">Order</th>
            {showBuyer && <th scope="col">Buyer</th>}
            <th scope="col">Fabric</th>
            <th scope="col" className="num">Quantity</th>
            {showYarn && <th scope="col" className="num">Yarn needed</th>}
            <th scope="col">Required by</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td className="table-primary-cell"><Link to={`/orders/${order.id}`}>{order.orderNumber}</Link></td>
              {showBuyer && <td>{order.buyer.name}</td>}
              <td>{order.product.name}</td>
              <td className="num">{formatNumber(order.quantityMetres, 'm')}</td>
              {showYarn && <td className="num">{formatNumber(order.requiredYarnKg, 'kg')}</td>}
              <td>{formatDate(order.requiredBy)} <DeadlineChip order={order} /></td>
              <td><OrderStatusBadge status={order.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Open-order yarn demand next to available stock, per material and colour. Indicative only: the
 * formal per-order check is the feasibility panel on each order (GET /orders/:id/feasibility).
 */
function YarnDemand({ summary, openOrders }) {
  const rows = useMemo(() => {
    const map = new Map();
    for (const row of summary) map.set(`${row.material}|${row.colour}`, { material: row.material, colour: row.colour, availableKg: row.availableKg, neededKg: 0, orders: 0 });
    for (const order of openOrders) {
      const key = `${order.product.material}|${order.product.colour}`;
      const row = map.get(key) ?? { material: order.product.material, colour: order.product.colour, availableKg: 0, neededKg: 0, orders: 0 };
      row.neededKg += order.requiredYarnKg ?? 0;
      row.orders += 1;
      map.set(key, row);
    }
    return [...map.values()].sort((a, b) => a.availableKg - a.neededKg - (b.availableKg - b.neededKg));
  }, [summary, openOrders]);

  if (rows.length === 0) return <EmptyState title="No stock and no open orders yet" />;
  return (
    <>
      <table className="erp-data-table">
        <thead>
          <tr>
            <th scope="col">Material · colour</th>
            <th scope="col" className="num">Available</th>
            <th scope="col" className="num">Needed by open orders</th>
            <th scope="col">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const gap = Math.round((row.availableKg - row.neededKg) * 1000) / 1000;
            return (
              <tr key={`${row.material}-${row.colour}`}>
                <td className="table-primary-cell">{row.material} · {row.colour}</td>
                <td className="num">{formatNumber(row.availableKg, 'kg')}</td>
                <td className="num">{row.orders ? `${formatNumber(row.neededKg, 'kg')} (${row.orders} order${row.orders > 1 ? 's' : ''})` : '—'}</td>
                <td>
                  {row.orders === 0 ? (
                    <StatusBadge tone="neutral" label="No demand" />
                  ) : gap >= 0 ? (
                    <StatusBadge tone="success" label="Covered" />
                  ) : (
                    <StatusBadge tone="danger" label={`Short by ${formatNumber(-gap, 'kg')}`} />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="card-footnote">
        Indicative: compares open-order demand (new and confirmed orders) with unreserved stock. Yarn is
        reserved per order by the floor manager once the order is confirmed.
      </p>
    </>
  );
}

function ModuleStatus({ role }) {
  // A development aid only: production builds have no sample screens to point to.
  const previews = PREVIEW_NAV.filter((item) => item.roles.includes(role));
  if (!SHOW_SAMPLE_SCREENS || previews.length === 0) return null;
  return (
    <div className="erp-card">
      <h3 className="card-title">What is live</h3>
      <p className="card-subtitle">Live screens read and write the real database. Previews show sample data only.</p>
      <ul className="module-list">
        <li><CheckCircle2 size={14} aria-hidden="true" /> Sign-in, roles and user accounts</li>
        <li><CheckCircle2 size={14} aria-hidden="true" /> Buyers, fabric catalog and orders</li>
        <li><CheckCircle2 size={14} aria-hidden="true" /> Order feasibility check and confirmation</li>
        <li><CheckCircle2 size={14} aria-hidden="true" /> Yarn reservation, issue to production and returns</li>
        <li><CheckCircle2 size={14} aria-hidden="true" /> Machines: registry, maintenance, problems and downtime</li>
        <li><CheckCircle2 size={14} aria-hidden="true" /> Production runs and roll output</li>
        <li><CheckCircle2 size={14} aria-hidden="true" /> Roll traceability and quality control (cryptographically signed decisions)</li>
        <li><CheckCircle2 size={14} aria-hidden="true" /> Finished goods, signed dispatch and invoices</li>
        <li><CheckCircle2 size={14} aria-hidden="true" /> Audit trail by role and buyer order timeline</li>
        <li><CheckCircle2 size={14} aria-hidden="true" /> Yarn inventory, ledger and reconciliation</li>
        {previews.map((item) => (
          <li key={item.to} className="module-preview">
            <FlaskConical size={14} aria-hidden="true" /> <Link to={item.to}>{item.label}</Link> — preview ({item.phase})
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({ title, subtitle, action, children }) {
  return (
    <div className="erp-card section-gap">
      <div className="card-header">
        <div>
          <h3 className="card-title">{title}</h3>
          {subtitle && <p className="card-subtitle">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── Role dashboards ──────────────────────────────────────────────────────────────

function AdminDashboard() {
  const dash = useDashboardData({
    open: () => ordersApi.list({ status: 'ORDER_CREATED', limit: 100 }),
    pipeline: loadPipelineOrders,
    all: () => ordersApi.list({ limit: 1 }),
    rejected: () => ordersApi.list({ status: 'REJECTED', limit: 1 }),
    cancelled: () => ordersApi.list({ status: 'CANCELLED', limit: 1 }),
    summary: () => inventoryApi.summary(),
    buyers: () => buyersApi.list({ isActive: true, limit: 1 }),
    products: () => productsApi.list({ limit: 1 }),
    users: () => usersApi.list({ isActive: true, limit: 1 }),
  });
  if (dash.error) return <ErrorState error={dash.error} onRetry={dash.reload} />;
  if (!dash.data) return <LoadingState label="Loading factory overview…" />;
  const d = dash.data;
  const open = d.open.data.orders.sort(byDeadline);
  const urgent = overdueOrDueSoon(open);
  const openValue = open.reduce((sum, order) => sum + (order.orderValuePaise ?? 0), 0);
  const stockKg = d.summary.data.summary.reduce((sum, row) => sum + row.availableKg, 0);

  return (
    <>
      <div className="erp-tall-kpi-grid">
        <Kpi label="Orders awaiting decision" value={open.length} sub={`${formatPaise(openValue)} total value`} icon={ClipboardList} to="/orders" />
        <Kpi label="Due within 7 days" value={urgent.length} sub={urgent.length ? 'Needs attention' : 'Nothing urgent'} icon={AlertTriangle} alert={urgent.length > 0} to="/orders" />
        <Kpi label="Yarn available" value={formatNumber(Math.round(stockKg), 'kg')} sub={`${d.summary.data.summary.length} material/colour lines`} icon={Box} to="/inventory" />
        <Kpi label="Orders all time" value={d.all.meta.total} sub={`${d.cancelled.meta.total} cancelled · ${d.rejected.meta.total} rejected`} icon={ClipboardList} to="/orders" />
        <Kpi label="Active buyers" value={d.buyers.meta.total} sub={`${d.products.meta.total} catalog fabrics`} icon={Building2} to="/buyers" />
        <Kpi label="Active users" value={d.users.meta.total} sub="Across all roles" icon={UsersIcon} to="/users" />
      </div>
      <Section title="Orders awaiting confirmation" subtitle="Earliest deadline first. Open one to check feasibility and confirm, or reject.">
        <OpenOrdersTable orders={open.slice(0, 8)} showBuyer showYarn emptyText="No new orders are waiting." />
      </Section>
      <div className="detail-columns">
        <Section title="Yarn demand vs stock" subtitle="New and confirmed orders compared with unreserved stock.">
          <YarnDemand summary={d.summary.data.summary} openOrders={d.pipeline.data.orders} />
        </Section>
        <ModuleStatus role={ROLES.ADMIN} />
      </div>
    </>
  );
}

function BuyerDashboard() {
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const { user } = useAuth();
  const orders = useApiQuery(() => ordersApi.list({ limit: 100 }), []);
  if (!user.buyerId) {
    return (
      <EmptyState title="Your account is not linked to a buyer company">
        Ask the factory administrator to link your account so you can place and track orders.
      </EmptyState>
    );
  }
  if (orders.error) return <ErrorState error={orders.error} onRetry={orders.reload} />;
  if (!orders.data) return <LoadingState label="Loading your orders…" />;
  const list = orders.data.orders;
  const open = list.filter(isOpenOrder).sort(byDeadline);
  const closed = list.filter((order) => !isOpenOrder(order));
  const openValue = open.reduce((sum, order) => sum + (order.orderValuePaise ?? 0), 0);

  return (
    <>
      <div className="erp-tall-kpi-grid">
        <Kpi label="Orders in progress" value={open.length} sub={formatPaise(openValue)} icon={ClipboardList} to="/orders" />
        <Kpi label="Due within 7 days" value={overdueOrDueSoon(open).length} icon={AlertTriangle} />
        <Kpi label="Closed" value={closed.length} sub="Cancelled or rejected" icon={CheckCircle2} />
      </div>
      <Section
        title="Your orders in progress"
        subtitle="Each bar shows the stages the factory has recorded."
        action={<button type="button" className="erp-btn-primary" onClick={() => setCreating(true)}><Plus size={15} aria-hidden="true" /> Place order</button>}
      >
        {open.length === 0 ? (
          <EmptyState title="No orders in progress">Place an order from the fabric catalog to get started.</EmptyState>
        ) : (
          <div className="buyer-order-list">
            {open.map((order) => (
              <Link key={order.id} to={`/orders/${order.id}`} className="buyer-order-card">
                <div className="buyer-order-top">
                  <strong>{order.orderNumber}</strong>
                  <OrderStatusBadge status={order.status} />
                </div>
                <div className="buyer-order-meta">
                  {formatNumber(order.quantityMetres, 'm')} {order.product.name} · required by {formatDate(order.requiredBy)} <DeadlineChip order={order} />
                </div>
                <OrderProgress order={order} />
              </Link>
            ))}
          </div>
        )}
      </Section>
      {creating && <CreateOrderModal onClose={() => setCreating(false)} onCreated={(order) => navigate(`/orders/${order.id}`)} />}
    </>
  );
}

function StoreDashboard() {
  const dash = useDashboardData({
    summary: () => inventoryApi.summary(),
    lots: () => inventoryApi.lots({ limit: 1 }),
    open: loadPipelineOrders,
  });
  // The store's to-do list: yarn shortages to resolve (receive stock) and reserved yarn to issue to the floor.
  if (dash.error) return <ErrorState error={dash.error} onRetry={dash.reload} />;
  if (!dash.data) return <LoadingState label="Loading stock…" />;
  const d = dash.data;
  const summary = d.summary.data.summary;
  const available = summary.reduce((sum, row) => sum + row.availableKg, 0);
  const reserved = summary.reduce((sum, row) => sum + row.reservedKg, 0);
  return (
    <>
      <div className="erp-tall-kpi-grid">
        <Kpi label="Yarn available" value={formatNumber(Math.round(available), 'kg')} icon={Box} to="/inventory" />
        <Kpi label="Reserved for orders" value={formatNumber(Math.round(reserved), 'kg')} icon={Box} />
        <Kpi label="Lots in stock" value={d.lots.meta.total} icon={Box} to="/inventory" />
        <Kpi label="Open orders" value={d.open.data.orders.length} sub="New or confirmed: will need yarn" icon={ClipboardList} to="/orders" />
      </div>
      <Section title="Yarn demand vs stock" subtitle="Shortages are yours to resolve: receive the missing yarn so orders can be confirmed and reserved." action={<Link className="erp-btn-primary" to="/inventory">Receive yarn</Link>}>
        <YarnDemand summary={summary} openOrders={d.open.data.orders} />
      </Section>
    </>
  );
}

function FloorDashboard() {
  const dash = useDashboardData({
    open: loadPipelineOrders,
    reserved: loadReservedOrders,
    summary: () => inventoryApi.summary(),
    machines: () => machinesApi.list({ limit: 100 }),
  });
  if (dash.error) return <ErrorState error={dash.error} onRetry={dash.reload} />;
  if (!dash.data) return <LoadingState label="Loading work queue…" />;
  // The work queue includes orders whose yarn is reserved (ready for production); yarn demand
  // counts only orders without a reservation, because reserved yarn is already set aside.
  const pending = dash.data.open.data.orders;
  const open = [...pending, ...dash.data.reserved.data.orders].sort(byDeadline);
  const machineCount = (status) => dash.data.machines.data.machines.filter((machine) => machine.status === status).length;
  return (
    <>
      <div className="erp-tall-kpi-grid">
        <Kpi label="Orders in the pipeline" value={open.length} icon={ClipboardList} to="/orders" />
        <Kpi label="Due within 7 days" value={overdueOrDueSoon(open).length} icon={AlertTriangle} alert={overdueOrDueSoon(open).length > 0} />
        <Kpi label="Fabric to weave" value={formatNumber(open.reduce((sum, order) => sum + order.quantityMetres, 0), 'm')} sub="Across open orders" icon={Shirt} />
        <Kpi
          label="Machines available"
          value={`${machineCount('AVAILABLE')} / ${dash.data.machines.data.machines.length}`}
          sub={`${machineCount('DOWN')} down · ${machineCount('MAINTENANCE')} in maintenance`}
          icon={Factory}
          alert={machineCount('DOWN') > 0}
          to="/machines"
        />
      </div>
      <Section title="Waiting for yarn reservation" subtitle="Confirmed orders, earliest deadline first. Open one to reserve its yarn for production.">
        <OpenOrdersTable orders={pending.filter((order) => order.status === 'CONFIRMED').sort(byDeadline)} showBuyer showYarn emptyText="No confirmed orders are waiting for a reservation." />
      </Section>
      <Section title="Upcoming work, by deadline" subtitle="Plan runs on available machines from each order's page.">
        <OpenOrdersTable orders={open} showBuyer showYarn emptyText="No orders in the pipeline." />
      </Section>
      <Section title="Yarn on hand">
        <YarnDemand summary={dash.data.summary.data.summary} openOrders={pending} />
      </Section>
    </>
  );
}

function QcDashboard() {
  const open = useApiQuery(loadPipelineOrders, []);
  // Real rolls waiting for inspection (this used to be a fixed "none" message).
  const pending = useApiQuery(() => rollsApi.list({ status: 'QC_PENDING', limit: 10 }), []);
  const rolls = pending.data?.rolls ?? [];
  return (
    <>
      <Section title="Pending inspections" subtitle="Rolls reach QC after production; oldest first." action={<Link to="/quality" className="erp-btn-primary">Open quality control</Link>}>
        {pending.error && <ErrorState error={pending.error} onRetry={pending.reload} />}
        {!pending.error && !pending.data && <LoadingState />}
        {pending.data && rolls.length === 0 && <EmptyState title="No rolls awaiting inspection">New rolls appear here as the floor records them.</EmptyState>}
        {rolls.length > 0 && (
          <table className="erp-data-table">
            <thead><tr><th scope="col">Roll</th><th scope="col">Order</th><th scope="col">Machine</th><th scope="col" className="num">Length</th></tr></thead>
            <tbody>
              {rolls.map((r) => (
                <tr key={r.id}>
                  <td className="mono"><Link to={`/rolls/${r.id}`}>{r.rollNumber}</Link></td>
                  <td>{r.orderNumber}</td>
                  <td>{r.machineCode}</td>
                  <td className="num">{formatNumber(r.lengthMetres, 'm')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pending.meta?.total > rolls.length && <p className="card-footnote">{pending.meta.total - rolls.length} more in Quality control.</p>}
      </Section>
      <Section title="Orders coming through the pipeline" subtitle="So you can plan inspection capacity.">
        {open.error && <ErrorState error={open.error} onRetry={open.reload} />}
        {!open.error && !open.data && <LoadingState />}
        {open.data && <OpenOrdersTable orders={open.data.orders.sort(byDeadline)} showBuyer showYarn={false} emptyText="No orders in the pipeline." />}
      </Section>
    </>
  );
}

const DASHBOARDS = {
  [ROLES.ADMIN]: { component: AdminDashboard, subtitle: 'Factory-wide overview.' },
  [ROLES.BUYER]: { component: BuyerDashboard, subtitle: 'Your company’s orders and where each one stands.' },
  [ROLES.STORE_KEEPER]: { component: StoreDashboard, subtitle: 'Yarn stock and what open orders will need.' },
  [ROLES.FLOOR_MANAGER]: { component: FloorDashboard, subtitle: 'The work queue for the production floor.' },
  [ROLES.QC_INSPECTOR]: { component: QcDashboard, subtitle: 'Inspection work and the orders behind it.' },
};

export default function Dashboard() {
  const { user } = useAuth();
  const config = DASHBOARDS[user.role];
  const Board = config.component;
  return (
    <div>
      <PageHeader title={`Welcome, ${user.name.split(' ')[0]}`} subtitle={`${ROLE_LABELS[user.role]} · ${config.subtitle}`} />
      <OperationalInsights />
      <Board />
    </div>
  );
}
