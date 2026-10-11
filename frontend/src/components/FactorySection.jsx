import {
  Box,
  Disc,
  Grid,
  Droplets,
  Maximize2,
  CheckSquare,
  Layers,
  Truck,
  AlertOctagon,
  Activity,
  CheckCircle2,
  Play,
  Pause,
  Wrench,
  AlertTriangle,
} from 'lucide-react';

const sectionIconMap = {
  Box,
  Disc,
  Grid,
  Droplets,
  Maximize2,
  CheckSquare,
  Layers,
  Truck,
};

function getStatusIcon(status) {
  switch (status) {
    case 'DOWN':
    case 'OUT_OF_SERVICE':
      return <AlertOctagon size={14} className="unit-icon-down" />;
    case 'RUNNING':
      return <Activity size={14} className="unit-icon-neutral" />;
    case 'AVAILABLE':
      return <CheckCircle2 size={14} className="unit-icon-neutral" />;
    case 'IDLE':
    case 'ASSIGNED':
      return <Play size={14} className="unit-icon-neutral" />;
    case 'PAUSED':
      return <Pause size={14} className="unit-icon-neutral" />;
    case 'MAINTENANCE':
      return <Wrench size={14} className="unit-icon-neutral" />;
    default:
      return <Activity size={14} className="unit-icon-neutral" />;
  }
}

export default function FactorySection({
  section,
  units,
  allSectionUnits,
  selectedUnit,
  onSelectUnit,
}) {
  const SectionIcon = sectionIconMap[section.iconName] || Grid;

  const totalInSection = allSectionUnits.length;
  const availableCount = allSectionUnits.filter((u) => u.status === 'AVAILABLE').length;
  const runningCount = allSectionUnits.filter((u) => u.status === 'RUNNING').length;
  const downCount = allSectionUnits.filter((u) => u.status === 'DOWN' || u.status === 'OUT_OF_SERVICE').length;

  return (
    <section className="factory-section-panel" aria-labelledby={`section-title-${section.id}`}>
      <div className="factory-section-header">
        <div className="factory-section-title-wrap">
          <div className="factory-section-icon-box">
            <SectionIcon size={18} className="factory-section-icon" />
          </div>
          <div>
            <div className="factory-section-heading-row">
              <h2 id={`section-title-${section.id}`} className="factory-section-name">
                {section.name}
              </h2>
              <span className="factory-section-prefix-badge">{section.prefix}</span>
            </div>
            <p className="factory-section-type">{section.type}</p>
          </div>
        </div>

        <div className="factory-section-meta">
          <div className="factory-section-count-badge" title={`${runningCount} Running, ${availableCount} Available of ${totalInSection} total units`}>
            <span className="count-available">{availableCount} Avail</span>
            <span className="count-separator">/</span>
            <span className="count-total">{totalInSection} Units</span>
          </div>
          {downCount > 0 && (
            <span className="factory-section-down-alert" title={`${downCount} unit(s) currently DOWN in this section`}>
              <AlertTriangle size={12} />
              <span>{downCount} DOWN</span>
            </span>
          )}
        </div>
      </div>

      <p className="factory-section-desc">{section.description}</p>

      {/* Unit Tiles Grid */}
      <div className="factory-unit-tiles-grid" role="list">
        {units.length === 0 ? (
          <div className="factory-section-empty">
            <span>No units match active filters</span>
          </div>
        ) : (
          units.map((unit) => {
            const isDown = unit.status === 'DOWN' || unit.status === 'OUT_OF_SERVICE';
            const isSelected = selectedUnit?.id === unit.id;

            return (
              <button
                key={unit.id}
                type="button"
                role="listitem"
                className={`factory-unit-tile ${isDown ? 'is-down' : ''} ${
                  isSelected ? 'is-selected' : ''
                } ${unit.tone ? `floor-tone-${unit.tone}` : ''}`}
                onClick={() => onSelectUnit(unit)}
                title={`${unit.id} • ${unit.name} • Status: ${unit.status} • Location: ${unit.location}`}
                aria-label={`Unit ${unit.id}, ${unit.name}, Status ${unit.status}`}
              >
                <div className="factory-unit-tile-top">
                  <span className="factory-unit-id">{unit.id}</span>
                  {getStatusIcon(unit.status)}
                </div>
                <div className="factory-unit-tile-bottom">
                  <span className={`factory-unit-status-tag ${isDown ? 'tag-down' : ''} ${unit.tone ? `floor-tone-${unit.tone}` : ''}`}>
                    {unit.status.replace(/_/g, ' ')}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
