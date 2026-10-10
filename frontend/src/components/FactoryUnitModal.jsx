import { useState, useEffect } from 'react';
import {
  X,
  AlertTriangle,
  Wrench,
  CheckCircle2,
  Clock,
  FileText,
  AlertOctagon,
} from 'lucide-react';

export default function FactoryUnitModal({
  unit,
  isOpen,
  onClose,
  onReportProblem,
  reportedProblems = [],
}) {
  const [activeTab, setActiveTab] = useState('OVERVIEW');
  const [showReportForm, setShowReportForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionSuccess, setSubmissionSuccess] = useState(false);

  // Problem form state
  const [formCategory, setFormCategory] = useState('Mechanical');
  const [formSeverity, setFormSeverity] = useState('Medium');
  const [formDescription, setFormDescription] = useState('');
  const [formErrors, setFormErrors] = useState({});

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showReportForm) {
          setShowReportForm(false);
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showReportForm, onClose]);

  if (!isOpen || !unit) return null;

  const isDown = unit.status === 'DOWN';
  const unitProblems = reportedProblems.filter((p) => p.unitId === unit.id);

  const handleFormSubmit = (e) => {
    e.preventDefault();
    const errors = {};
    if (!formDescription.trim()) {
      errors.description = 'Please provide a detailed description of the issue.';
    } else if (formDescription.trim().length < 10) {
      errors.description = 'Description must be at least 10 characters long.';
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setIsSubmitting(true);
    setFormErrors({});

    const newReport = {
      id: `REP-${Date.now().toString().slice(-4)}`,
      unitId: unit.id,
      unitName: unit.name,
      section: unit.section,
      category: formCategory,
      severity: formSeverity,
      description: formDescription.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      date: new Date().toISOString().slice(0, 10),
      isDemoState: true,
    };

    // Store in local application state
    onReportProblem(newReport);
    setIsSubmitting(false);
    setSubmissionSuccess(true);
    setShowReportForm(false);
    setFormDescription('');
  };

  return (
    <div
      className="factory-modal-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="factory-modal-title"
    >
      <div
        className="factory-modal-container"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="factory-modal-header">
          <div className="factory-modal-header-info">
            <div className="factory-modal-title-row">
              <span className="factory-modal-id-badge">{unit.id}</span>
              <h2 id="factory-modal-title" className="factory-modal-title">
                {unit.name}
              </h2>
            </div>
            <div className="factory-modal-subrow">
              <span className="factory-modal-section-badge">{unit.section}</span>
              <span className="factory-modal-type-badge">{unit.type || 'Equipment'}</span>
              <span className={`factory-modal-status-badge ${isDown ? 'is-down' : ''}`}>
                {isDown ? <AlertOctagon size={13} style={{ marginRight: 4 }} /> : null}
                {unit.status}
              </span>
              <span className="factory-modal-demo-tag">DEMO DATA</span>
            </div>
          </div>

          <div className="factory-modal-header-actions">
            {!showReportForm && (
              <button
                type="button"
                className="factory-btn-report-problem"
                onClick={() => setShowReportForm(true)}
                title="Report problem for this unit"
              >
                <Wrench size={14} />
                <span>Report Problem</span>
              </button>
            )}
            <button
              type="button"
              className="factory-modal-close-btn"
              onClick={onClose}
              title="Close details (Esc)"
              aria-label="Close details"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Local Demo Submission Confirmation Banner */}
        {submissionSuccess && (
          <div className="factory-alert-box demo-success-alert">
            <CheckCircle2 size={16} className="text-neutral" />
            <div className="factory-alert-text">
              <strong>Problem Report Logged Locally:</strong> Demo report submitted for{' '}
              {unit.id}.
              <div className="text-xs text-muted">
                Stored in local session memory. Not transmitted to external production server.
              </div>
            </div>
            <button
              type="button"
              className="factory-alert-dismiss"
              onClick={() => setSubmissionSuccess(false)}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Critical Down Banner if unit is DOWN */}
        {isDown && (
          <div className="factory-alert-box down-alert">
            <AlertTriangle size={18} className="alert-red-icon" />
            <div className="factory-alert-text">
              <strong className="text-red">Critical Unit Breakdown Detected</strong>
              <div>
                This unit is currently flagged as DOWN. Maintenance crew dispatch requested.
              </div>
            </div>
          </div>
        )}

        {/* Report Problem Form Subview */}
        {showReportForm ? (
          <div className="factory-problem-form-container">
            <div className="factory-problem-form-header">
              <div className="problem-form-title-group">
                <Wrench size={18} />
                <div>
                  <h3 className="problem-form-title">Submit Incident / Maintenance Report</h3>
                  <p className="problem-form-subtitle">
                    Report an operational anomaly for unit <strong>{unit.id}</strong> ({unit.name}).
                  </p>
                </div>
              </div>
              <span className="problem-demo-notice">Demo Simulation Form</span>
            </div>

            <form onSubmit={handleFormSubmit} noValidate>
              <div className="factory-problem-form-grid">
                <div className="form-field-group">
                  <label className="form-label" htmlFor="unit-id-field">
                    Unit Identifier
                  </label>
                  <input
                    id="unit-id-field"
                    type="text"
                    className="form-input read-only"
                    value={`${unit.id} — ${unit.name} (${unit.section})`}
                    disabled
                  />
                </div>

                <div className="form-field-row">
                  <div className="form-field-group">
                    <label className="form-label" htmlFor="problem-category-select">
                      Problem Category <span className="field-required">*</span>
                    </label>
                    <select
                      id="problem-category-select"
                      className="form-select"
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                    >
                      <option value="Mechanical">Mechanical</option>
                      <option value="Electrical">Electrical</option>
                      <option value="Production">Production</option>
                      <option value="Quality">Quality</option>
                      <option value="Material">Material</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div className="form-field-group">
                    <label className="form-label" htmlFor="problem-severity-select">
                      Severity Level <span className="field-required">*</span>
                    </label>
                    <select
                      id="problem-severity-select"
                      className={`form-select ${formSeverity === 'Critical' ? 'severity-critical' : ''}`}
                      value={formSeverity}
                      onChange={(e) => setFormSeverity(e.target.value)}
                    >
                      <option value="Low">Low — Minor observation / non-urgent</option>
                      <option value="Medium">Medium — Scheduled shift review</option>
                      <option value="High">High — Performance bottleneck</option>
                      <option value="Critical">Critical — Immediate stoppage hazard</option>
                    </select>
                  </div>
                </div>

                <div className="form-field-group">
                  <label className="form-label" htmlFor="problem-description-input">
                    Observation & Issue Description <span className="field-required">*</span>
                  </label>
                  <textarea
                    id="problem-description-input"
                    rows={4}
                    className={`form-textarea ${formErrors.description ? 'has-error' : ''}`}
                    placeholder="Provide detailed observations (e.g. yarn guide vibration, temperature spike, sensor misalignment)..."
                    value={formDescription}
                    onChange={(e) => {
                      setFormDescription(e.target.value);
                      if (formErrors.description) {
                        setFormErrors({});
                      }
                    }}
                  />
                  {formErrors.description && (
                    <span className="form-error-msg">{formErrors.description}</span>
                  )}
                </div>

                <div className="form-notice-box">
                  <FileText size={14} />
                  <span>
                    Reports are logged in client demonstration state. Submitting will not automatically halt or mutate machine operational states without technician confirmation.
                  </span>
                </div>
              </div>

              <div className="factory-problem-form-footer">
                <button
                  type="button"
                  className="factory-btn-secondary"
                  onClick={() => setShowReportForm(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="factory-btn-primary"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Logging...' : 'Submit Demo Report'}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <>
            {/* Modal Navigation Tabs */}
            <div className="factory-modal-tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'OVERVIEW'}
                className={`factory-modal-tab-btn ${activeTab === 'OVERVIEW' ? 'active' : ''}`}
                onClick={() => setActiveTab('OVERVIEW')}
              >
                OVERVIEW
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'PRODUCTION'}
                className={`factory-modal-tab-btn ${activeTab === 'PRODUCTION' ? 'active' : ''}`}
                onClick={() => setActiveTab('PRODUCTION')}
              >
                PRODUCTION
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'HISTORY'}
                className={`factory-modal-tab-btn ${activeTab === 'HISTORY' ? 'active' : ''}`}
                onClick={() => setActiveTab('HISTORY')}
              >
                HISTORY
                {unitProblems.length > 0 && (
                  <span className="tab-badge">{unitProblems.length}</span>
                )}
              </button>
            </div>

            {/* Tab 1: OVERVIEW */}
            {activeTab === 'OVERVIEW' && (
              <div className="factory-modal-tab-panel" role="tabpanel">
                <div className="factory-detail-grid">
                  <div className="detail-item">
                    <span className="detail-label">Unit / Machine ID</span>
                    <strong className="detail-value">{unit.id}</strong>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Designated Name</span>
                    <strong className="detail-value">{unit.name}</strong>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Factory Section</span>
                    <strong className="detail-value">{unit.section}</strong>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Operational Status</span>
                    <strong className={`detail-value ${isDown ? 'text-red' : ''}`}>
                      {unit.status}
                    </strong>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Floor Location</span>
                    <strong className="detail-value">{unit.location || 'Not available'}</strong>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Assigned Operator</span>
                    <strong className="detail-value">{unit.operator || 'Not available'}</strong>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Active Shift</span>
                    <strong className="detail-value">{unit.shift || 'Not available'}</strong>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Telemetry Last Updated</span>
                    <strong className="detail-value">{unit.lastUpdated || 'Not available'}</strong>
                  </div>

                  {/* Contextual fields for Storage units */}
                  {unit.storedMaterial && (
                    <>
                      <div className="detail-item">
                        <span className="detail-label">Stored Inventory Material</span>
                        <strong className="detail-value">{unit.storedMaterial}</strong>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">Current Staged Quantity</span>
                        <strong className="detail-value">{unit.quantity || 'Not available'}</strong>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">Maximum Storage Capacity</span>
                        <strong className="detail-value">{unit.capacity || 'Not available'}</strong>
                      </div>
                    </>
                  )}

                  {/* Contextual fields for Quality Stations */}
                  {unit.pendingInspections && (
                    <>
                      <div className="detail-item">
                        <span className="detail-label">Pending Inspection Queue</span>
                        <strong className="detail-value">{unit.pendingInspections}</strong>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">Inspection Grading Standard</span>
                        <strong className="detail-value">{unit.standards || 'Not available'}</strong>
                      </div>
                    </>
                  )}

                  {/* Contextual fields for Dispatch Stations */}
                  {unit.dockType && (
                    <>
                      <div className="detail-item">
                        <span className="detail-label">Dock Classification</span>
                        <strong className="detail-value">{unit.dockType}</strong>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">Carrier Manifest Verification</span>
                        <strong className="detail-value">{unit.manifestStatus || 'Not available'}</strong>
                      </div>
                      <div className="detail-item">
                        <span className="detail-label">Assigned Carrier / Vehicle</span>
                        <strong className="detail-value">{unit.assignedCarrier || 'Not available'}</strong>
                      </div>
                    </>
                  )}

                  <div className="detail-item full-width">
                    <span className="detail-label">Operational Notes & Directives</span>
                    <p className="detail-notes">{unit.notes || 'Not available'}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: PRODUCTION */}
            {activeTab === 'PRODUCTION' && (
              <div className="factory-modal-tab-panel" role="tabpanel">
                <div className="factory-detail-grid">
                  <div className="detail-item">
                    <span className="detail-label">Current Production Order</span>
                    <strong className="detail-value font-mono">
                      {unit.currentOrder && unit.currentOrder !== 'Not available'
                        ? unit.currentOrder
                        : 'Not available (Idle / Standby)'}
                    </strong>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Fabric Specification / Lot</span>
                    <strong className="detail-value">{unit.product || 'Not available'}</strong>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Shift Output</span>
                    <strong className="detail-value">{unit.currentOutput || 'Not available'}</strong>
                  </div>
                  <div className="detail-item">
                    <span className="detail-label">Target Shift Quota</span>
                    <strong className="detail-value">{unit.targetOutput || 'Not available'}</strong>
                  </div>
                  <div className="detail-item full-width">
                    <div className="progress-label-row">
                      <span className="detail-label">Equipment Utilization</span>
                      <strong className="detail-value">{unit.utilization || '0%'}</strong>
                    </div>
                    <div className="utilization-bar-bg">
                      <div
                        className="utilization-bar-fill"
                        style={{
                          width: `${Math.min(parseInt(unit.utilization || '0', 10), 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 3: HISTORY */}
            {activeTab === 'HISTORY' && (
              <div className="factory-modal-tab-panel" role="tabpanel">
                {unitProblems.length > 0 && (
                  <div className="history-section">
                    <h4 className="history-subtitle">Locally Reported Incident Records</h4>
                    <div className="history-list">
                      {unitProblems.map((prob) => (
                        <div key={prob.id} className="history-card incident-card">
                          <div className="history-card-header">
                            <span className="history-badge-incident">{prob.category}</span>
                            <span className={`history-severity-tag ${prob.severity === 'Critical' ? 'tag-critical' : ''}`}>
                              {prob.severity} Severity
                            </span>
                            <span className="history-time">{prob.date} {prob.timestamp}</span>
                          </div>
                          <p className="history-desc">{prob.description}</p>
                          <span className="history-sub-demo">Session memory only • Demo state</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="history-section">
                  <h4 className="history-subtitle">Operational Event Timeline</h4>
                  {unit.history && unit.history.length > 0 ? (
                    <div className="history-list">
                      {unit.history.map((h, idx) => (
                        <div key={idx} className="history-card">
                          <div className="history-card-header">
                            <Clock size={13} className="text-muted" />
                            <span className="history-time">{h.time}</span>
                          </div>
                          <p className="history-desc">{h.event}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted text-sm">No historical log entries available for this demonstration unit.</p>
                  )}
                </div>
              </div>
            )}

            {/* Modal Footer */}
            <div className="factory-modal-footer">
              <span className="factory-footer-legend">
                {isDown ? 'Status: Critical Down' : `Status: ${unit.status}`} • Demonstration Telemetry
              </span>
              <button
                type="button"
                className="factory-btn-secondary"
                onClick={onClose}
              >
                Close (Esc)
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
