import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fulfilmentApi } from '../api/endpoints.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ROLES } from '../auth/roles.js';
import { InvoiceView } from '../components/fulfilment/Fulfilment.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { EmptyState, ErrorState, ListLimitNotice, LoadingState } from '../components/ui/States.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { formatDate, formatPaise } from '../utils/format.js';

/** Invoices: all of them for the owner, only the company's own for a buyer. */
export default function Invoices() {
  const { user } = useAuth();
  const invoices = useApiQuery(() => fulfilmentApi.invoices({ limit: 100 }), []);
  const [viewing, setViewing] = useState(null);
  const list = invoices.data?.invoices ?? [];
  const isBuyer = user.role === ROLES.BUYER;
  return (
    <div>
      <PageHeader title="Invoices" subtitle={isBuyer ? 'Invoices for your company’s dispatched orders.' : 'One invoice per confirmed dispatch.'} breadcrumbs={[{ label: 'Dashboard', to: '/dashboard' }, { label: 'Invoices' }]} />
      <div className="erp-card">
        {invoices.error && <ErrorState error={invoices.error} onRetry={invoices.reload} />}
        {!invoices.error && !invoices.data && <LoadingState />}
        {invoices.data && list.length === 0 && <EmptyState title="No invoices yet" />}
        {list.length > 0 && (
          <table className="erp-data-table">
            <thead><tr><th scope="col">Invoice</th><th scope="col">Order</th>{!isBuyer && <th scope="col">Buyer</th>}<th scope="col">Dispatch</th><th scope="col">Issued</th><th scope="col" className="num">Total</th><th scope="col"><span className="sr-only">View</span></th></tr></thead>
            <tbody>
              {list.map((inv) => (
                <tr key={inv.id}>
                  <td className="mono">{inv.invoiceNumber}</td>
                  <td><Link to={`/orders/${inv.orderId}`}>{inv.orderNumber}</Link></td>
                  {!isBuyer && <td>{inv.buyer.name}</td>}
                  <td>{inv.dispatchNumber}</td>
                  <td>{formatDate(inv.issuedAt)}</td>
                  <td className="num">{formatPaise(inv.totalPaise)}</td>
                  <td className="row-actions"><button type="button" className="erp-btn-outline erp-btn-sm" onClick={() => setViewing(inv)}>View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ListLimitNotice shown={list.length} total={invoices.meta?.total} />
      </div>
      {viewing && <InvoiceView invoice={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
