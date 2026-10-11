import { Link, useParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { fulfilmentApi } from '../api/endpoints.js';
import { InvoiceSheet } from '../components/fulfilment/Fulfilment.jsx';
import { PageHeader } from '../components/ui/PageHeader.jsx';
import { ErrorState, LoadingState } from '../components/ui/States.jsx';
import { useApiQuery } from '../hooks/useApiQuery.js';
import { formatDate } from '../utils/format.js';

/**
 * One invoice, at its own address (/invoices/:id) so every invoice number in the app opens it. The
 * server decides access: the admin sees any invoice, a buyer only their own company's (404 otherwise).
 */
export default function InvoiceDetail() {
  const { id } = useParams();
  const data = useApiQuery(() => fulfilmentApi.getInvoice(id), [id]);
  const invoice = data.data?.invoice;
  const crumbs = [{ label: 'Dashboard', to: '/dashboard' }, { label: 'Invoices', to: '/invoices' }, { label: invoice?.invoiceNumber ?? 'Invoice' }];
  if (data.error) {
    return (
      <div>
        <PageHeader title="Invoice" breadcrumbs={crumbs} />
        <div className="erp-card"><ErrorState error={data.error} onRetry={data.error.status === 404 ? undefined : data.reload} /></div>
      </div>
    );
  }
  if (!invoice) return <div className="erp-card"><LoadingState label="Loading invoice…" /></div>;
  return (
    <div>
      <PageHeader
        title={`Invoice ${invoice.invoiceNumber}`}
        subtitle={<>Issued {formatDate(invoice.issuedAt)} · dispatch {invoice.dispatchNumber} · order <Link to={`/orders/${invoice.orderId}`}>{invoice.orderNumber}</Link></>}
        breadcrumbs={crumbs}
        actions={<button type="button" className="erp-btn-primary" onClick={() => window.print()}><Printer size={15} aria-hidden="true" /> Print</button>}
      />
      <div className="erp-card">
        <InvoiceSheet invoice={invoice} />
      </div>
    </div>
  );
}
