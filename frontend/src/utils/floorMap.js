import { toneOf } from './statusTones.js';

/*
 * The factory floor map (pages/Machines.jsx) shows the RECORDED machine records, not sensor telemetry.
 * Status colour (one rule, the MACHINE tones of statusTones.js):
 *   red    'down'        DOWN, or retired (out of service)
 *   orange 'maintenance' MAINTENANCE
 *   green  'running'     RUNNING
 *   yellow 'idle'        AVAILABLE, ASSIGNED, PAUSED (not running, can be used)
 */

/** Machine type → floor-map section id (factorySections in data/factoryFloorData.js). */
export const SECTION_BY_TYPE = Object.freeze({ SPINNING: 'spinning', WEAVING: 'weaving', DYEING: 'dyeing', FINISHING: 'finishing' });

export const FLOOR_LEGEND = Object.freeze([
  { tone: 'running', label: 'Running' },
  { tone: 'idle', label: 'Idle / available' },
  { tone: 'maintenance', label: 'Maintenance' },
  { tone: 'down', label: 'Not working / out of service' },
]);

/** The status shown on the floor: a retired machine is OUT_OF_SERVICE whatever its last status. */
export const floorStatus = (machine) => (machine.isActive === false ? 'OUT_OF_SERVICE' : machine.status);

export const floorTone = (machine) => toneOf('MACHINE', floorStatus(machine));

/** A backend machine as a floor-map unit (the shape FactorySection draws). */
export function toFloorUnit(machine, sections) {
  const sectionId = SECTION_BY_TYPE[machine.type] ?? null;
  const section = sections.find((s) => s.id === sectionId);
  return {
    id: machine.code,
    machineId: machine.id,
    name: machine.name,
    type: machine.type,
    status: floorStatus(machine),
    tone: floorTone(machine),
    sectionId,
    section: section?.name ?? '',
    location: machine.location ?? '—',
    statusChangedAt: machine.statusChangedAt ?? null,
  };
}

/** Counts by recorded status (KPI cards and the summary table). */
export function floorCounts(units) {
  const n = (...statuses) => units.filter((u) => statuses.includes(u.status)).length;
  return {
    total: units.length,
    running: n('RUNNING'),
    available: n('AVAILABLE'),
    idle: n('ASSIGNED'),
    paused: n('PAUSED'),
    maintenance: n('MAINTENANCE'),
    down: n('DOWN', 'OUT_OF_SERVICE'),
  };
}
