import { useState } from 'react';
import { Layers, Plus, Search, Filter, Cpu, DollarSign, CheckCircle2 } from 'lucide-react';
import { boms } from '../data/mockData';

export default function BOM() {
  const [recipes, setRecipes] = useState(boms);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLoom, setSelectedLoom] = useState('All');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newBOM, setNewBOM] = useState({
    fabric: '',
    description: '',
    yarn: 'Cotton Yarn 40s Ne',
    yarnPerMeter: 0.18,
    warpCount: '40s Ne',
    weftCount: '40s Ne',
    endsPerInch: 100,
    picksPerInch: 60,
    loomType: 'Rapier Loom',
    standardSpeed: '40 m/hr',
    standardCostPerMeter: 65,
  });

  const filtered = recipes.filter((r) => {
    const matchesSearch =
      r.fabric.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.yarn.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesLoom = selectedLoom === 'All' || r.loomType === selectedLoom;
    return matchesSearch && matchesLoom;
  });

  const handleCreate = (e) => {
    e.preventDefault();
    const created = {
      ...newBOM,
      id: `BOM-${String(recipes.length + 1).padStart(3, '0')}`,
    };
    setRecipes([...recipes, created]);
    setShowAddModal(false);
  };

  return (
    <div className="erp-page-container">
      <div className="erp-page-header">
        <div className="erp-page-header-text">
          <h1 className="erp-page-title">Bill of Materials (BOM)</h1>
          <p className="erp-page-subtitle">
            Fabric weave recipes, yarn consumption ratios, and loom machine configurations
          </p>
        </div>
        <div className="erp-page-actions">
          <button className="erp-btn-primary" onClick={() => setShowAddModal(true)}>
            <Plus size={16} />
            <span>Create BOM Recipe</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="erp-filter-bar">
        <div className="filter-chips-row">
          {['All', 'Rapier Loom', 'Air Jet Loom', 'Dobby Loom'].map((loom) => (
            <button
              key={loom}
              className={`erp-filter-chip ${selectedLoom === loom ? 'active' : ''}`}
              onClick={() => setSelectedLoom(loom)}
            >
              {loom}
            </button>
          ))}
        </div>
        <div className="erp-search-box">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search fabric or yarn..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* BOM Cards Grid */}
      <div className="erp-bom-grid">
        {filtered.map((bom) => (
          <div key={bom.id} className="erp-card bom-card">
            <div className="bom-card-header">
              <div>
                <span className="bom-id-badge">{bom.id}</span>
                <h3 className="bom-fabric-title">{bom.fabric}</h3>
              </div>
              <span className="bom-loom-tag">{bom.loomType}</span>
            </div>
            <p className="bom-desc">{bom.description}</p>

            <div className="bom-specs-grid">
              <div className="bom-spec-item">
                <span className="bom-spec-label">Primary Yarn</span>
                <strong className="bom-spec-val">{bom.yarn}</strong>
              </div>
              <div className="bom-spec-item">
                <span className="bom-spec-label">Consumption Ratio</span>
                <strong className="bom-spec-val">{bom.yarnPerMeter} kg / meter</strong>
              </div>
              <div className="bom-spec-item">
                <span className="bom-spec-label">Warp / Weft Counts</span>
                <strong className="bom-spec-val">
                  {bom.warpCount} × {bom.weftCount}
                </strong>
              </div>
              <div className="bom-spec-item">
                <span className="bom-spec-label">Density (EPI × PPI)</span>
                <strong className="bom-spec-val">
                  {bom.endsPerInch} × {bom.picksPerInch}
                </strong>
              </div>
              <div className="bom-spec-item">
                <span className="bom-spec-label">Standard Speed</span>
                <strong className="bom-spec-val">{bom.standardSpeed}</strong>
              </div>
              <div className="bom-spec-item">
                <span className="bom-spec-label">Standard Base Cost</span>
                <strong className="bom-spec-val">₹{bom.standardCostPerMeter.toFixed(2)} / m</strong>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal to Add BOM */}
      {showAddModal && (
        <div className="erp-modal-overlay">
          <div className="erp-modal-box">
            <div className="modal-header">
              <h3 className="modal-title">Define New Fabric Recipe (BOM)</h3>
              <button className="modal-close-btn" onClick={() => setShowAddModal(false)}>
                ✕
              </button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="erp-form-grid">
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="erp-label">Fabric Commercial Name</label>
                    <input
                      type="text"
                      className="erp-input"
                      placeholder="e.g. Denim 12oz Warp Slub"
                      value={newBOM.fabric}
                      onChange={(e) => setNewBOM({ ...newBOM, fabric: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label className="erp-label">Technical Description</label>
                    <input
                      type="text"
                      className="erp-input"
                      placeholder="e.g. Indigo rope dyed warp with ring spun open end weft"
                      value={newBOM.description}
                      onChange={(e) => setNewBOM({ ...newBOM, description: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="erp-label">Primary Yarn Variety</label>
                    <input
                      type="text"
                      className="erp-input"
                      value={newBOM.yarn}
                      onChange={(e) => setNewBOM({ ...newBOM, yarn: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="erp-label">Yarn Consumption (kg/m)</label>
                    <input
                      type="number"
                      step="0.01"
                      className="erp-input"
                      value={newBOM.yarnPerMeter}
                      onChange={(e) =>
                        setNewBOM({ ...newBOM, yarnPerMeter: parseFloat(e.target.value) })
                      }
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="erp-label">Compatible Loom</label>
                    <select
                      className="erp-select"
                      value={newBOM.loomType}
                      onChange={(e) => setNewBOM({ ...newBOM, loomType: e.target.value })}
                    >
                      <option>Rapier Loom</option>
                      <option>Air Jet Loom</option>
                      <option>Dobby Loom</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="erp-label">Standard Cost (₹/m)</label>
                    <input
                      type="number"
                      className="erp-input"
                      value={newBOM.standardCostPerMeter}
                      onChange={(e) =>
                        setNewBOM({ ...newBOM, standardCostPerMeter: parseFloat(e.target.value) })
                      }
                      required
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="erp-btn-outline"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="erp-btn-primary">
                  Save BOM Recipe
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
