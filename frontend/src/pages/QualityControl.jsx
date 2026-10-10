import { useState, useEffect } from 'react';
import {
  CheckSquare,
  XSquare,
  AlertCircle,
  FileText,
  Search,
  Download,
  ShieldCheck,
  CheckCircle2,
  X,
  Sparkles,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { exportToCSV } from '../utils/csvExport';

const resultFilters = ['All', 'PASS', 'REWORK', 'REJECT'];

export default function QualityControl() {
  const { qcInspections, submitQCInspection, orders, machines, toast } = useApp();
  const [activeFilter, setActiveFilter] = useState('All');
  const [showInspectionModal, setShowInspectionModal] = useState(false);

  const [formData, setFormData] = useState({
    rollId: 'ROLL-1001-09',
    orderId: orders[0]?.id || 'ORD-2410-001',
    machineId: 'Rapier Loom A-12',
    fabric: 'Cotton Twill 2/1',
    meters: 450,
    result: 'PASS',
    defectType: 'None',
    notes: 'Uniform density and clean selvedge verified.',
    signature: 'Mohan Verma',
  });

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setShowInspectionModal(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const filtered = qcInspections.filter((qc) => {
    if (activeFilter === 'All') return true;
    return qc.result === activeFilter;
  });

  const passCount = qcInspections.filter((q) => q.result === 'PASS').length;
  const failCount = qcInspections.filter((q) => q.result !== 'PASS').length;
  const avgDefects = (
    qcInspections.reduce((sum, q) => sum + q.defectsPerHundred, 0) / qcInspections.length
  ).toFixed(1);

  const handleSubmit = (e) => {
    e.preventDefault();
    submitQCInspection(formData);
    setShowInspectionModal(false);
  };

  const handleExportCSV = () => {
    exportToCSV('Everest_Textile_QC_Audits.csv', filtered, [
      { key: 'id', label: 'Inspection ID' },
      { key: 'rollId', label: 'Roll ID' },
      { key: 'orderId', label: 'Order ID' },
      { key: 'machineId', label: 'Loom / Machine' },
      { key: 'fabric', label: 'Fabric' },
      { key: 'meters', label: 'Meters' },
      { key: 'result', label: 'QC Result' },
      { key: 'defectsPerHundred', label: 'Defects / 100m' },
      { key: 'defectType', label: 'Defect Type' },
      { key: 'inspector', label: 'Certified Inspector' },
      { key: 'timestamp', label: 'Timestamp' },
    ]);
    toast.info(`Exported ${filtered.length} QC inspections to CSV.`, 'CSV Exported');
  };

  return (
    <div className="erp-page-container">
      <div className="erp-page-header">
        <div className="erp-page-header-text">
          <h1 className="erp-page-title">Quality Control & Roll Certification</h1>
          <p className="erp-page-subtitle">
            Section 10 & 11: Fabric roll traceability, defect logging, and cryptographic digital signature approval
          </p>
        </div>
        <div className="erp-page-actions">
          <button className="erp-btn-outline" onClick={handleExportCSV} title="Export QC inspection log as CSV">
            <Download size={16} />
            <span>Export Audits</span>
          </button>
          <button className="erp-btn-primary" onClick={() => setShowInspectionModal(true)}>
            <FileText size={16} />
            <span>New Inspection Signoff</span>
          </button>
        </div>
      </div>

      {/* KPI Summary */}
      <div className="erp-tall-kpi-grid" style={{ marginBottom: 20 }}>
        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Total Inspected Rolls</span>
            <CheckSquare size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">{qcInspections.length}</div>
          <div className="tall-kpi-subtext">Active batch audits</div>
        </div>

        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Certified Passed</span>
            <ShieldCheck size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">{passCount}</div>
          <div className="tall-kpi-change">
            {((passCount / qcInspections.length) * 100).toFixed(0)}% First-Time Pass Rate
          </div>
        </div>

        <div className={`erp-tall-kpi-card ${failCount > 0 ? 'error' : ''}`}>
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Rework / Rejected</span>
            <XSquare size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value" style={failCount > 0 ? { color: 'var(--color-error)' } : {}}>
            {failCount}
          </div>
          <div className="tall-kpi-subtext" style={failCount > 0 ? { color: 'var(--color-error)' } : {}}>
            {failCount > 0 ? 'Quarantine & finishing rework required' : 'Zero failures'}
          </div>
        </div>

        <div className="erp-tall-kpi-card">
          <div className="tall-kpi-header">
            <span className="tall-kpi-label">Defects / 100m</span>
            <AlertCircle size={16} className="tall-kpi-icon" />
          </div>
          <div className="tall-kpi-value">{avgDefects}</div>
          <div className="tall-kpi-subtext">ASTM D5430 Standard: ≤ 2.5</div>
        </div>
      </div>

      {/* Filters */}
      <div className="erp-filter-bar">
        <div className="filter-chips-row">
          {resultFilters.map((filter) => (
            <button
              key={filter}
              className={`erp-filter-chip ${activeFilter === filter ? 'active' : ''}`}
              onClick={() => setActiveFilter(filter)}
            >
              {filter}
            </button>
          ))}
        </div>
      </div>

      {/* QC Inspections Table */}
      <div className="erp-card">
        <div className="erp-table-wrapper">
          <table className="erp-data-table">
            <thead>
              <tr>
                <th>Inspection ID</th>
                <th>Roll ID</th>
                <th>Order ID</th>
                <th>Loom / Work Center</th>
                <th>Fabric Variety</th>
                <th>Output Meters</th>
                <th>Result</th>
                <th>Defect Details</th>
                <th>Digital Signature Seal</th>
                <th>Inspector</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((qc) => (
                <tr key={qc.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{qc.id}</td>
                  <td className="table-primary-cell">{qc.rollId}</td>
                  <td>{qc.orderId}</td>
                  <td>{qc.machineId}</td>
                  <td>{qc.fabric}</td>
                  <td>{qc.meters} m</td>
                  <td>
                    <span
                      className={`erp-status-badge ${
                        qc.result === 'PASS'
                          ? 'active'
                          : qc.result === 'REWORK'
                          ? 'error'
                          : 'error'
                      }`}
                    >
                      {qc.result}
                    </span>
                  </td>
                  <td>
                    <div>
                      <strong>{qc.defectType}</strong>
                      <div className="text-xs text-secondary">{qc.notes}</div>
                    </div>
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <ShieldCheck size={14} />
                      <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
                        {qc.digitalSignature}
                      </span>
                    </div>
                  </td>
                  <td>{qc.inspector}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: New Inspection & Digital Signature Approval (Section 10 & 11) */}
      {showInspectionModal && (
        <div
          className="erp-modal-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowInspectionModal(false);
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="erp-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title">Record QC Inspection & Digital Signature</h3>
                <p className="modal-subtitle">
                  Section 11: Inspector legally confirms roll inspection and authenticity
                </p>
              </div>
              <button className="modal-close-btn" onClick={() => setShowInspectionModal(false)}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="erp-form-grid">
                  <div className="form-group">
                    <label className="erp-label">Fabric Roll ID</label>
                    <input
                      type="text"
                      className="erp-input"
                      value={formData.rollId}
                      onChange={(e) => setFormData({ ...formData, rollId: e.target.value })}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="erp-label">Origin Manufacturing Order</label>
                    <select
                      className="erp-select"
                      value={formData.orderId}
                      onChange={(e) => setFormData({ ...formData, orderId: e.target.value })}
                    >
                      {orders.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.id} ({o.fabric})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="erp-label">Source Loom / Machine</label>
                    <select
                      className="erp-select"
                      value={formData.machineId}
                      onChange={(e) => setFormData({ ...formData, machineId: e.target.value })}
                    >
                      {machines.map((m) => (
                        <option key={m.id} value={m.name}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="erp-label">Roll Output Length (Meters)</label>
                    <input
                      type="number"
                      className="erp-input"
                      value={formData.meters}
                      onChange={(e) => setFormData({ ...formData, meters: Number(e.target.value) })}
                      required
                    />
                  </div>

                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="erp-label">Inspection Verdict</label>
                    <select
                      className="erp-select"
                      value={formData.result}
                      onChange={(e) => setFormData({ ...formData, result: e.target.value })}
                    >
                      <option value="PASS">PASS — Approve & Transfer to Finished Goods</option>
                      <option value="REWORK">REWORK — Defect identified, send to finishing shed</option>
                      <option value="REJECT">REJECT — Scrap roll, non-recoverable defect</option>
                    </select>
                  </div>

                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="erp-label">Defect Observation</label>
                    <input
                      type="text"
                      className="erp-input"
                      placeholder="e.g. None or Weft bar streak or Color shading"
                      value={formData.defectType}
                      onChange={(e) => setFormData({ ...formData, defectType: e.target.value })}
                    />
                  </div>

                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="erp-label">Inspection Notes</label>
                    <textarea
                      className="erp-input"
                      rows={2}
                      value={formData.notes}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    />
                  </div>

                  {/* Digital Signature Confirmation Box */}
                  <div className="digital-signature-box" style={{ gridColumn: 'span 2' }}>
                    <div className="sig-header">
                      <ShieldCheck size={18} />
                      <strong>Digital Cryptographic Signature Sign-Off</strong>
                    </div>
                    <p className="sig-statement">
                      "I hereby certify that I have physically inspected fabric roll {formData.rollId} against ASTM 4-point standards and affirm this recorded verdict."
                    </p>
                    <div className="form-group" style={{ marginTop: 8 }}>
                      <label className="erp-label">Inspector Name & Key</label>
                      <input
                        type="text"
                        className="erp-input"
                        value={formData.signature}
                        onChange={(e) => setFormData({ ...formData, signature: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="erp-btn-outline"
                  onClick={() => setShowInspectionModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="erp-btn-primary">
                  Digitally Sign & Commit QC Approval
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
