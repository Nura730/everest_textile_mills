import { Machine } from '../models/Machine.js';

// A small dev floor: weaving makes both catalog fabrics; one machine of each other type.
// Rated speeds are stored in cm per hour: 1500 = 15 m/h.
export const DEV_MACHINES = Object.freeze([
  { code: 'W-01', name: 'Weaving loom 1', type: 'WEAVING', ratedCmPerHour: 1500, location: 'Hall A' },
  { code: 'W-02', name: 'Weaving loom 2', type: 'WEAVING', ratedCmPerHour: 1500, location: 'Hall A' },
  { code: 'W-03', name: 'Weaving loom 3 (air-jet)', type: 'WEAVING', ratedCmPerHour: 2500, location: 'Hall B' },
  { code: 'S-01', name: 'Ring spinning frame 1', type: 'SPINNING', ratedCmPerHour: 4000, location: 'Spinning shed' },
  { code: 'D-01', name: 'Jet dyeing machine 1', type: 'DYEING', ratedCmPerHour: 3000, location: 'Dye house' },
]);

/**
 * Dev-only machines, all AVAILABLE. Idempotent: existing machines (and their status and history)
 * are never changed.
 */
export async function seedDevMachines({ nodeEnv }) {
  if (nodeEnv === 'production') throw new Error('seed:dev refuses to run with NODE_ENV=production.');
  const report = [];
  for (const machine of DEV_MACHINES) {
    const result = await Machine.updateOne({ code: machine.code }, { $setOnInsert: { ...machine } }, { upsert: true });
    report.push({ code: machine.code, type: machine.type, status: result.upsertedCount === 1 ? 'created' : 'exists' });
  }
  return report;
}
