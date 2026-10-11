import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { shiftOfHour } from '../../src/constants/shifts.js';
import { Machine } from '../../src/models/Machine.js';
import { QcInspection } from '../../src/models/QcInspection.js';
import { Roll } from '../../src/models/Roll.js';
import { User } from '../../src/models/User.js';
import { todayInIndia } from '../../src/utils/dates.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';

let app;
let admin;
let floor;
let qc;
let store;
let loomA;
let loomB;
const id = () => new mongoose.Types.ObjectId();
const today = todayInIndia();
const at = (hhmm) => new Date(`${today}T${hhmm}:00.000+05:30`); // a time today, Indian time
const get = (actor, path) => request(app).get(path).set('Authorization', bearer(actor));
let seq = 0;
const roll = (machine, cm, createdAt, status = 'QC_PASSED') => {
  seq += 1;
  return { rollNumber: `R-RP-${seq}`, orderId: id(), orderNumber: 'O', runId: id(), runNumber: 'RUN', machineId: machine._id, machineCode: machine.code, lengthCm: cm, status, producedBy: floor._id, createdAt };
};

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await Promise.all([User.init(), Machine.init(), Roll.init(), QcInspection.init()]);
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
  floor = await createTestUser({ role: ROLES.FLOOR_MANAGER });
  qc = await createTestUser({ role: ROLES.QC_INSPECTOR });
  store = await createTestUser({ role: ROLES.STORE_KEEPER });
  [loomA, loomB] = await Machine.create([
    { code: 'W-RA', name: 'Loom A', type: 'WEAVING', ratedCmPerHour: 1500 },
    { code: 'W-RB', name: 'Loom B', type: 'WEAVING', ratedCmPerHour: 1500 },
  ]);
});

afterEach(async () => {
  await Promise.all([Machine.deleteMany({}), Roll.deleteMany({}), QcInspection.collection.deleteMany({}), User.deleteMany({})]);
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('shifts', () => {
  it('morning 06–14, evening 14–22, night 22–06', () => {
    expect([5, 6, 13, 14, 21, 22, 0].map(shiftOfHour)).toEqual(['NIGHT', 'MORNING', 'MORNING', 'EVENING', 'EVENING', 'NIGHT', 'NIGHT']);
  });
});

describe('production report', () => {
  it('output per machine (today and period), per shift, per day, and defects by machine and type', async () => {
    await Roll.create([roll(loomA, 10_000, at('07:30')), roll(loomA, 5_000, at('15:00'), 'REJECTED'), roll(loomB, 20_000, at('23:15'))].filter((r) => r.createdAt <= new Date()));
    const inspection = (machine, result, defects = []) => ({ rollId: id(), rollNumber: 'R', orderId: id(), runId: id(), machineId: machine._id, attempt: 1, result, defects, inspectorId: qc._id, inspectorName: 'QC', inspectedAt: new Date() });
    await QcInspection.create([inspection(loomA, 'PASS'), inspection(loomA, 'REJECT', [{ type: 'COLOUR_MISMATCH', severity: 'MAJOR' }]), inspection(loomB, 'REWORK', [{ type: 'COLOUR_MISMATCH', severity: 'MINOR' }])]);

    const res = await get(floor, `/api/reports/production?from=${today}&to=${today}`);
    expect(res.status).toBe(200);
    const r = res.body.data;
    const recorded = await Roll.find().lean();
    const a = r.byMachine.find((x) => x.code === 'W-RA');
    const aRolls = recorded.filter((x) => String(x.machineId) === String(loomA._id));
    expect(a).toMatchObject({ rolls: aRolls.length, todayRolls: aRolls.length, inspections: 2, failedInspections: 1, defectRatePercent: 50 });
    expect(a.producedMetres).toBe(aRolls.reduce((s, x) => s + x.lengthCm, 0) / 100);
    expect(r.byShift.map((s) => s.shift)).toEqual(['MORNING', 'EVENING', 'NIGHT']);
    expect(r.byShift.reduce((s, x) => s + x.rolls, 0)).toBe(recorded.length);
    if (recorded.some((x) => x.createdAt.getTime() === at('07:30').getTime())) expect(r.byShift[0].producedMetres).toBeGreaterThanOrEqual(100);
    expect(r.byDefectType).toEqual([{ type: 'COLOUR_MISMATCH', count: 2 }]);
    expect(r.byDay.reduce((s, d) => s + d.rolls, 0)).toBe(recorded.length);
  });

  it('roles: floor, QC and admin; never the store keeper; dates validated', async () => {
    expect((await get(qc, `/api/reports/production?from=${today}&to=${today}`)).status).toBe(200);
    expect((await get(store, `/api/reports/production?from=${today}&to=${today}`)).status).toBe(403);
    expect((await get(admin, `/api/reports/production?from=${today}&to=2000-01-01`)).status).toBe(400);
    const t = await get(admin, '/api/reports/today');
    expect(t.body.data).toMatchObject({ date: today, inspections: { pass: 0, rework: 0, reject: 0 } });
    expect((await get(qc, '/api/reports/today')).status).toBe(403);
  });
});
