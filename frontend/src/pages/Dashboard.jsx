import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Box, Building2, CheckCircle2, ClipboardList, FlaskConical, Plus, Shirt, Users as UsersIcon } from 'lucide-react';
import { buyersApi, inventoryApi, ordersApi, productsApi, usersApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { PREVIEW_NAV, ROLES, ROLE_LABELS } from '../auth/roles.js';
import { CreateOrderModal } from '../components/orders/CreateOrderModal.jsx';
import { DeadlineChip, OrderProgress, OrderStatusBadge } from '../components/ui/OrderStatus.jsx';
import { isOpenOrder } from '../utils/orderStatus.js';
import { PageHeader } from '../components/ui/PageHeader.jsx';
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
                    <span className="erp-status-badge neutral">No demand</span>
                  ) : gap >= 0 ? (
                    <span className="erp-status-badge active">Covered</span>
                  ) : (
                    <span className="deadline-chip overdue">Short by {formatNumber(-gap, 'kg')}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="card-footnote">
        Indicative: compares total open-order demand with unreserved stock. Yarn is reserved per order once
        material reservation (next phase) is live.
      </p>
    </>
  );
}

function ModuleStatus({ role }) {
  const previews = PREVIEW_NAV.filter((item) => item.roles.includes(role));
  if (previews.length === 0) return null;
  return (
    <div className="erp-card">
      <h3 className="card-title">What is live</h3>
      <p className="card-subtitle">Live screens read and write the real database. Previews show sample data only.</p>
      <ul className="module-list">
        <li><CheckCircle2 size={14} aria-hidden="true" /> Sign-in, roles and user accounts</li>
        <li><CheckCircle2 size={14} aria-hidden="true" /> Buyers, fabric catalog and orders</li>
        <li><CheckCircle2 size={14} aria-hidden="true" /> Order feasibility check and confirmation</li>
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
      <Section title="Yarn demand vs stock" subtitle="Plan purchases before shortages hit the floor." action={<Link className="erp-btn-primary" to="/inventory">Receive yarn</Link>}>
        <YarnDemand summary={summary} openOrders={d.open.data.orders} />
      </Section>
    </>
  );
}

function FloorDashboard() {
  const dash = useDashboardData({
    open: loadPipelineOrders,
    summary: () => inventoryApi.summary(),
  });
  if (dash.error) return <ErrorState error={dash.error} onRetry={dash.reload} />;
  if (!dash.data) return <LoadingState label="Loading work queue…" />;
  const open = dash.data.open.data.orders.sort(byDeadline);
  return (
    <>
      <div className="erp-tall-kpi-grid">
        <Kpi label="Orders in the pipeline" value={open.length} icon={ClipboardList} to="/orders" />
        <Kpi label="Due within 7 days" value={overdueOrDueSoon(open).length} icon={AlertTriangle} alert={overdueOrDueSoon(open).length > 0} />
        <Kpi label="Fabric to weave" value={formatNumber(open.reduce((sum, order) => sum + order.quantityMetres, 0), 'm')} sub="Across open orders" icon={Shirt} />
      </div>
      <Section title="Upcoming work, by deadline" subtitle="Production runs are assigned to machines once the production module is live (preview: Production).">
        <OpenOrdersTable orders={open} showBuyer showYarn emptyText="No orders in the pipeline." />
      </Section>
      <Section title="Yarn on hand">
        <YarnDemand summary={dash.data.summary.data.summary} openOrders={open} />
      </Section>
    </>
  );
}

function QcDashboard() {
  const open = useApiQuery(loadPipelineOrders, []);
  return (
    <>
      <Section title="Pending inspections" subtitle="Rolls reach QC after production.">
        <EmptyState title="No rolls awaiting inspection">
          Inspections start when production records rolls. The QC module is a planned phase; its screen is
          available as a preview with sample data.
        </EmptyState>
        <div className="center"><Link to="/quality" className="erp-btn-outline">Open QC preview</Link></div>
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
  [ROLES.ADMIN]: { component: AdminDashboard, subtitle: 'Factory-wide overview from live data.' },
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
      <Board />
    </div>
  );
}
