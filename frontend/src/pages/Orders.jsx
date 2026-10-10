import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { ordersApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ROLES, can } from '../auth/roles.js';
import { CreateOrderModal } from '../components/orders/CreateOrderModal.jsx';
import { DeadlineChip, OrderProgress, OrderStatusBadge } from '../components/ui/OrderStatus.jsx';
import { STATUS_LABELS } from '../utils/orderStatus.js';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { formatDate, formatNumber, formatPaise } from '../utils/format.js';

const PAGE_SIZE = 20;

export default function Orders() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isBuyer = user.role === ROLES.BUYER;
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  const orders = useApiQuery(() => ordersApi.list({ status, page, limit: PAGE_SIZE }), [status, page]);
  const list = orders.data?.orders ?? [];
  const total = orders.meta?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const showsMoney = list.some((order) => order.orderValuePaise !== undefined);

  return (
    <div>
      <PageHeader
        title={isBuyer ? 'My orders' : 'Orders'}
        subtitle={
          isBuyer
            ? 'Every order your company has placed, with its current stage.'
            : 'All buyer orders, newest first. Open an order for its full history.'
        }
        breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: isBuyer ? 'My orders' : 'Orders' }]}
        actions={
          <>
            <button type="button" className="erp-btn-outline" onClick={orders.reload} disabled={orders.loading} aria-label="Refresh orders">
              <RefreshCw size={15} className={orders.loading ? 'spin' : ''} aria-hidden="true" /> Refresh
            </button>
            {can.createOrder(user.role) && (
              <button type="button" className="erp-btn-primary" onClick={() => setCreating(true)}>
                <Plus size={15} aria-hidden="true" /> Place order
              </button>
            )}
          </>
        }
      />

      <div className="erp-card">
        <div className="toolbar">
          <label className="erp-label" htmlFor="status-filter">Status</label>
          <select
            id="status-filter"
            className="erp-input toolbar-select"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <span className="toolbar-count">{orders.loading ? 'Loading…' : `${total} order${total === 1 ? '' : 's'}`}</span>
        </div>

        {orders.error && <ErrorState error={orders.error} onRetry={orders.reload} />}
        {!orders.error && orders.loading && !orders.data && <LoadingState label="Loading orders…" />}
        {!orders.error && orders.data && list.length === 0 && (
          <EmptyState
            title={status ? `No ${STATUS_LABELS[status].toLowerCase()} orders` : 'No orders yet'}
            action={
              can.createOrder(user.role) && !status ? (
                <button type="button" className="erp-btn-primary" onClick={() => setCreating(true)}>Place the first order</button>
              ) : null
            }
          >
            {isBuyer ? 'Orders you place appear here with their progress.' : 'Orders placed by buyers appear here.'}
          </EmptyState>
        )}

        {list.length > 0 && (
          <div className="erp-table-wrapper">
            <table className="erp-data-table">
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  {!isBuyer && <th scope="col">Buyer</th>}
                  <th scope="col">Fabric</th>
                  <th scope="col" className="num">Quantity</th>
                  <th scope="col">Required by</th>
                  <th scope="col">Status</th>
                  <th scope="col">Progress</th>
                  {showsMoney && <th scope="col" className="num">Value</th>}
                </tr>
              </thead>
              <tbody>
                {list.map((order) => (
                  <tr key={order.id} className="clickable-row" onClick={() => navigate(`/orders/${order.id}`)}>
                    <td className="table-primary-cell">
                      <Link to={`/orders/${order.id}`} onClick={(event) => event.stopPropagation()}>{order.orderNumber}</Link>
                    </td>
                    {!isBuyer && <td>{order.buyer.name}</td>}
                    <td>
                      {order.product.name}
                      <div className="cell-sub">{order.product.code}</div>
                    </td>
                    <td className="num">{formatNumber(order.quantityMetres, 'm')}</td>
                    <td>
                      {formatDate(order.requiredBy)}
                      <div><DeadlineChip order={order} /></div>
                    </td>
                    <td><OrderStatusBadge status={order.status} /></td>
                    <td><OrderProgress order={order} compact /></td>
                    {showsMoney && <td className="num">{formatPaise(order.orderValuePaise)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="pager">
            <button type="button" className="erp-btn-outline" disabled={page <= 1 || orders.loading} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page} of {pages}</span>
            <button type="button" className="erp-btn-outline" disabled={page >= pages || orders.loading} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}
      </div>

      {creating && (
        <CreateOrderModal
          onClose={() => setCreating(false)}
          onCreated={(order) => {
            setCreating(false);
            orders.reload();
            navigate(`/orders/${order.id}`);
          }}
        />
      )}
    </div>
  );
}
