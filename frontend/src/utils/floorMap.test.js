import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FLOOR_LEGEND, floorCounts, floorTone, toFloorUnit } from './floorMap.js';

const m = (status, extra = {}) => ({ id: 'x', code: 'W-01', name: 'Loom 1', type: 'WEAVING', status, isActive: true, ...extra });

test('status colours: red down/out of service, orange maintenance, green running, yellow idle/available', () => {
  assert.equal(floorTone(m('DOWN')), 'down');
  assert.equal(floorTone(m('RUNNING', { isActive: false })), 'down'); // retired = out of service
  assert.equal(floorTone(m('MAINTENANCE')), 'maintenance');
  assert.equal(floorTone(m('RUNNING')), 'running');
  for (const s of ['AVAILABLE', 'ASSIGNED', 'PAUSED']) assert.equal(floorTone(m(s)), 'idle');
  assert.deepEqual(FLOOR_LEGEND.map((l) => l.tone), ['running', 'idle', 'maintenance', 'down']);
});

test('machines are placed in the section of their type; counts come from the records', () => {
  const sections = [{ id: 'weaving', name: 'Weaving Section' }, { id: 'dyeing', name: 'Dyeing & Processing' }];
  const units = [m('RUNNING'), m('DOWN', { type: 'DYEING' }), m('AVAILABLE', { isActive: false }), m('PAUSED'), m('ASSIGNED')].map((x) => toFloorUnit(x, sections));
  assert.equal(units[0].section, 'Weaving Section');
  assert.equal(units[1].sectionId, 'dyeing');
  assert.equal(units[2].status, 'OUT_OF_SERVICE');
  assert.deepEqual(floorCounts(units), { total: 5, running: 1, available: 0, idle: 1, paused: 1, maintenance: 0, down: 2 });
});
