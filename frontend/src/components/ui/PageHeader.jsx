import { Link } from 'react-router-dom';
import { ChevronRight, FlaskConical } from 'lucide-react';

/** Page title, breadcrumbs and actions — the same on every screen. */
export function PageHeader({ title, subtitle, breadcrumbs = [], actions }) {
  return (
    <div className="erp-page-header">
      <div>
        {breadcrumbs.length > 0 && (
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            {breadcrumbs.map((crumb, index) => (
              <span key={crumb.label}>
                {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span aria-current="page">{crumb.label}</span>}
                {index < breadcrumbs.length - 1 && <ChevronRight size={12} aria-hidden="true" />}
              </span>
            ))}
          </nav>
        )}
        <h1 className="erp-page-title">{title}</h1>
        {subtitle && <p className="erp-page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="erp-page-actions">{actions}</div>}
    </div>
  );
}

/**
 * Wraps a screen that still shows SAMPLE data. Reviewers and users must never mistake it for live
 * data, so the banner is not dismissible.
 */
export function PreviewNotice({ phase, children }) {
  return (
    <>
      <div className="preview-banner" role="note">
        <FlaskConical size={18} aria-hidden="true" />
        <div>
          <strong>Preview — sample data, not connected to the backend.</strong>{' '}
          Nothing on this screen is saved. Planned: {phase}.
        </div>
      </div>
      {children}
    </>
  );
}
