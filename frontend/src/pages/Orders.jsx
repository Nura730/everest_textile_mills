import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, RefreshCw } from 'lucide-react';
import { buyersApi, ordersApi, productsApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { useLive } from '../realtime/realtimeBus.js';
import { CachedNotice } from '../offline/CachedNotice.jsx';
import { PendingActions } from '../offline/PendingActions.jsx';
import { ROLES, can } from '../auth/roles.js';
import { CreateOrderModal } from '../components/orders/CreateOrderModal.jsx';
import { FilterBar, FilterCheckbox, FilterDate, FilterSelect, SearchInput } from '../components/ui/Filters.jsx';
import { DeadlineChip, OrderProgress, OrderStatusBadge } from '../components/ui/OrderStatus.jsx';
import { STATUS_LABELS } from '../utils/orderStatus.js';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/ui/States.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { useFilters } from '../hooks/useFilters.js';
import { formatDate, formatNumber, formatPaise } from '../utils/format.js';

const PAGE_SIZE = 20;
const NO_FILTERS = { q: '', status: '', productId: '', buyerId: '', requiredFrom: '', requiredTo: '', overdue: false };

export default function Orders() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const isBuyer = user.role === ROLES.BUYER;
  const isAdmin = user.role === ROLES.ADMIN;
  const { filters, set, clear, query, active, page, setPage } = useFilters(NO_FILTERS);
  const [creating, setCreating] = useState(false);

  // Filter choices. Buyer companies can only be listed by an ADMIN (other staff use the search box);
  // the admin also sees retired products, because older orders may be for them.
  const products = useApiQuery(() => productsApi.list({ limit: 100, includeInactive: isAdmin }), [isAdmin], { cacheKey: `products:filter:${isAdmin}` });
  const buyers = useApiQuery(() => (isAdmin ? buyersApi.list({ limit: 100 }) : Promise.resolve({ data: { buyers: [] } })), [isAdmin], { cacheKey: isAdmin ? 'buyers:all' : undefined });

  const orders = useApiQuery(() => ordersApi.list({ ...query, page, limit: PAGE_SIZE }), [query, page], { cacheKey: `orders:${JSON.stringify(query)}:${page}` });
  useLive((entry) => Boolean(entry.orderId) || entry.entityType === 'Order', orders.reload);
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
      <CachedNotice cachedAt={orders.cachedAt} />
      <PendingActions title="Orders saved on this device" match={(item) => item.type === 'ORDER_CREATE'} onApplied={() => orders.reload()} />

      <div className="erp-card">
        <FilterBar active={active} onClear={clear} label="Order filters">
          <SearchInput
            id="order-search"
            value={filters.q}
            onChange={(value) => set('q', value)}
            placeholder={isBuyer ? 'Search order no. or fabric' : 'Search order no., buyer or fabric'}
          />
          <FilterSelect
            id="status-filter"
            label="Status"
            value={filters.status}
            onChange={(value) => set('status', value)}
            allLabel="All statuses"
            options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <FilterSelect
            id="product-filter"
            label="Fabric"
            value={filters.productId}
            onChange={(value) => set('productId', value)}
            allLabel="All fabrics"
            options={(products.data?.products ?? []).map((product) => ({ value: product.id, label: `${product.name} (${product.code})` }))}
          />
          {isAdmin && (
            <FilterSelect
              id="buyer-filter"
              label="Buyer"
              value={filters.buyerId}
              onChange={(value) => set('buyerId', value)}
              allLabel="All buyers"
              options={(buyers.data?.buyers ?? []).map((buyer) => ({ value: buyer.id, label: `${buyer.code} — ${buyer.name}` }))}
            />
          )}
          <FilterDate id="required-from" label="Required from" value={filters.requiredFrom} max={filters.requiredTo || undefined} onChange={(value) => set('requiredFrom', value)} />
          <FilterDate id="required-to" label="Required to" value={filters.requiredTo} min={filters.requiredFrom || undefined} onChange={(value) => set('requiredTo', value)} />
          <FilterCheckbox id="overdue-filter" label="Overdue only" checked={filters.overdue} onChange={(value) => set('overdue', value)} />
          <span className="toolbar-count">{orders.loading ? 'Loading…' : `${total} order${total === 1 ? '' : 's'}`}</span>
        </FilterBar>

        {orders.error && <ErrorState error={orders.error} onRetry={orders.reload} />}
        {!orders.error && orders.loading && !orders.data && <LoadingState label="Loading orders…" />}
        {!orders.error && orders.data && list.length === 0 && (
          active ? (
            <EmptyState
              title="No orders match these filters"
              action={<button type="button" className="erp-btn-outline" onClick={clear}>Clear filters</button>}
            >
              {filters.overdue ? 'Overdue means the required-by date has passed and the order is not yet delivered, cancelled or rejected.' : 'Try widening the dates or clearing a filter.'}
            </EmptyState>
          ) : (
            <EmptyState
              title="No orders yet"
              action={
                can.createOrder(user.role) ? (
                  <button type="button" className="erp-btn-primary" onClick={() => setCreating(true)}>Place the first order</button>
                ) : null
              }
            >
              {isBuyer ? 'Orders you place appear here with their progress.' : 'Orders placed by buyers appear here.'}
            </EmptyState>
          )
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
