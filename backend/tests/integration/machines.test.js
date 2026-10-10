import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { IdempotencyRecord } from '../../src/models/IdempotencyRecord.js';
import { Machine } from '../../src/models/Machine.js';
import { MachineEvent } from '../../src/models/MachineEvent.js';
import { User } from '../../src/models/User.js';
import { seedDevMachines } from '../../src/scripts/seedDevMachines.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { daysFromToday } from '../helpers/catalog.js';
import { newKey } from '../helpers/inventory.js';

let app;
let admin;
let floor;
let qc;
let loom;

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await Promise.all([User.init(), Machine.init(), MachineEvent.init(), IdempotencyRecord.init(), AuditLog.createCollection()]);
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
  floor = await createTestUser({ role: ROLES.FLOOR_MANAGER });
  qc = await createTestUser({ role: ROLES.QC_INSPECTOR });
  loom = (await request(app).post('/api/machines').set('Authorization', bearer(admin)).send({ code: 'w-03', name: 'Weaving loom 3', type: 'WEAVING', ratedMetresPerHour: 25, location: 'Hall B' })).body.data.machine;
});

afterEach(async () => {
  await Promise.all([
    Machine.deleteMany({}),
    MachineEvent.collection.deleteMany({}),
    AuditLog.collection.deleteMany({}),
    IdempotencyRecord.deleteMany({}),
    User.deleteMany({}),
  ]);
});

afterAll(async () => {
  await disconnectDatabase();
});

const get = (actor, path) => request(app).get(path).set('Authorization', bearer(actor));
const act = (actor, path, body = {}, key = newKey()) => request(app).post(path).set('Authorization', bearer(actor)).set('Idempotency-Key', key).send(body);
const status = async () => (await Machine.findById(loom.id).lean()).status;
const report = (severity, extra = {}, actor = floor) =>
  act(actor, `/api/machines/${loom.id}/problems`, { category: 'MECHANICAL', severity, description: 'Warp beam brake slipping', ...extra });
const resolve = (eventId, actor = floor) => act(actor, `/api/machines/${loom.id}/problems/${eventId}/resolve`, { resolution: 'Brake pads replaced' });

describe('machine registry', () => {
  it('registers a machine (ADMIN) with a normalised code, AVAILABLE, audited', async () => {
    expect(loom).toMatchObject({ code: 'W-03', type: 'WEAVING', ratedMetresPerHour: 25, status: 'AVAILABLE', isActive: true });
    expect((await Machine.findById(loom.id).lean()).ratedCmPerHour).toBe(2500);
    expect(await AuditLog.countDocuments({ action: 'MACHINE_CREATED', machineId: loom.id })).toBe(1);
  });

  it('rejects a duplicate code (409) and a bad body (400)', async () => {
    const dup = await request(app).post('/api/machines').set('Authorization', bearer(admin)).send({ code: 'W-03', name: 'Again', type: 'WEAVING', ratedMetresPerHour: 10 });
    expect(dup.body.error.code).toBe('DUPLICATE_RESOURCE');
    for (const body of [{ code: 'W-9', name: 'X', type: 'WEAVING', ratedMetresPerHour: 10 }, { code: 'W-9', name: 'Loom', type: 'KNITTING', ratedMetresPerHour: 10 }, { code: 'W-9', name: 'Loom', type: 'WEAVING', ratedMetresPerHour: 0 }, { code: 'W-9', name: 'Loom', type: 'WEAVING', ratedMetresPerHour: 10, status: 'RUNNING' }]) {
      expect((await request(app).post('/api/machines').set('Authorization', bearer(admin)).send(body)).status).toBe(400);
    }
  });

  it('lists with filters (type, status, search) and open-problem counts', async () => {
    await request(app).post('/api/machines').set('Authorization', bearer(admin)).send({ code: 'S-01', name: 'Spinning frame', type: 'SPINNING', ratedMetresPerHour: 40 });
    await report('LOW');
    const all = await get(floor, '/api/machines');
    expect(all.body.meta.total).toBe(2);
    expect(all.body.data.machines.find((m) => m.code === 'W-03').openProblems).toBe(1);
    expect((await get(floor, '/api/machines?type=SPINNING')).body.data.machines.map((m) => m.code)).toEqual(['S-01']);
    expect((await get(floor, '/api/machines?q=hall%20b')).body.data.machines.map((m) => m.code)).toEqual(['W-03']);
    expect((await get(floor, '/api/machines?status=DOWN')).body.meta.total).toBe(0);
    expect((await get(floor, '/api/machines?status=IDLE')).status).toBe(400);
  });

  it('edits name, speed and location with a stale-save guard; code and type are locked', async () => {
    const res = await request(app).patch(`/api/machines/${loom.id}`).set('Authorization', bearer(admin)).send({ expectedUpdatedAt: loom.updatedAt, ratedMetresPerHour: 30, location: null });
    expect(res.body.data.machine).toMatchObject({ ratedMetresPerHour: 30, location: null, code: 'W-03' });
    expect((await request(app).patch(`/api/machines/${loom.id}`).set('Authorization', bearer(admin)).send({ expectedUpdatedAt: loom.updatedAt, name: 'Stale save' })).body.error.code).toBe('CONFLICT');
    for (const locked of [{ code: 'W-99' }, { type: 'DYEING' }, { status: 'DOWN' }]) {
      expect((await request(app).patch(`/api/machines/${loom.id}`).set('Authorization', bearer(admin)).send({ expectedUpdatedAt: res.body.data.machine.updatedAt, ...locked })).status).toBe(400);
    }
  });

  it('retires a machine (history kept); a retired machine cannot take actions and is hidden by default', async () => {
    const retired = await request(app).patch(`/api/machines/${loom.id}/active`).set('Authorization', bearer(admin)).send({ isActive: false });
    expect(retired.body.data.machine.isActive).toBe(false);
    expect((await get(floor, '/api/machines')).body.meta.total).toBe(0);
    expect((await get(floor, '/api/machines?isActive=false')).body.meta.total).toBe(1);
    expect((await act(floor, `/api/machines/${loom.id}/maintenance/start`)).body.error.code).toBe('MACHINE_INACTIVE');
  });

  it('refuses to retire a machine with production booked or running', async () => {
    await Machine.updateOne({ _id: loom.id }, { $set: { status: 'RUNNING' } });
    expect((await request(app).patch(`/api/machines/${loom.id}/active`).set('Authorization', bearer(admin)).send({ isActive: false })).body.error.code).toBe('CONFLICT');
  });
});

describe('maintenance', () => {
  it('AVAILABLE → MAINTENANCE → AVAILABLE, with events and audit', async () => {
    const start = await act(floor, `/api/machines/${loom.id}/maintenance/start`, { note: 'Monthly lubrication' });
    expect(start.status).toBe(200);
    expect(start.body.data.machine.status).toBe('MAINTENANCE');
    expect((await act(floor, `/api/machines/${loom.id}/maintenance/end`)).body.data.machine.status).toBe('AVAILABLE');
    const events = (await get(qc, `/api/machines/${loom.id}/events`)).body.data.events.map((e) => [e.type, e.fromStatus, e.toStatus]);
    expect(events).toEqual([['MAINTENANCE_ENDED', 'MAINTENANCE', 'AVAILABLE'], ['MAINTENANCE_STARTED', 'AVAILABLE', 'MAINTENANCE']]);
    expect(await AuditLog.countDocuments({ action: { $in: ['MACHINE_MAINTENANCE_STARTED', 'MACHINE_MAINTENANCE_ENDED'] } })).toBe(2);
  });

  it('refuses invalid transitions with 409 and the allowed source states', async () => {
    expect((await act(floor, `/api/machines/${loom.id}/maintenance/end`)).body.error).toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { from: 'AVAILABLE', to: 'AVAILABLE', allowedFrom: ['MAINTENANCE'] } });
    for (const busy of ['RUNNING', 'ASSIGNED', 'DOWN']) {
      await Machine.updateOne({ _id: loom.id }, { $set: { status: busy } });
      expect((await act(floor, `/api/machines/${loom.id}/maintenance/start`)).body.error.code).toBe('INVALID_STATE_TRANSITION');
    }
  });

  it('replays a retried action instead of applying it twice', async () => {
    const key = newKey();
    await act(floor, `/api/machines/${loom.id}/maintenance/start`, {}, key);
    const retry = await act(floor, `/api/machines/${loom.id}/maintenance/start`, {}, key);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(await MachineEvent.countDocuments({ type: 'MAINTENANCE_STARTED' })).toBe(1);
  });
});

describe('problems', () => {
  it('a LOW/MEDIUM problem is recorded and stays open without changing the status', async () => {
    const res = await report('MEDIUM', { estimatedDowntimeMinutes: 30 });
    expect(res.status).toBe(201);
    expect(res.body.data.event).toMatchObject({ type: 'PROBLEM_REPORTED', fromStatus: 'AVAILABLE', toStatus: 'AVAILABLE', problem: { severity: 'MEDIUM', estimatedDowntimeMinutes: 30 } });
    expect(await status()).toBe('AVAILABLE');
    expect((await get(floor, `/api/machines/${loom.id}`)).body.data.openProblems).toHaveLength(1);
  });

  it('a CRITICAL problem takes the machine DOWN; resolving it brings it back', async () => {
    const critical = (await report('CRITICAL')).body.data.event;
    expect(await status()).toBe('DOWN');
    const fixed = await resolve(critical.id);
    expect(fixed.body.data.machine.status).toBe('AVAILABLE');
    expect(fixed.body.data.event).toMatchObject({ type: 'PROBLEM_RESOLVED', resolvesEventId: critical.id, note: 'Brake pads replaced' });
    const detail = (await get(floor, `/api/machines/${loom.id}`)).body.data;
    expect(detail.openProblems).toHaveLength(0);
    expect(detail.downtime).toMatchObject({ criticalProblems: 1, ongoing: false });
  });

  it('stays DOWN until the LAST critical problem is resolved', async () => {
    const first = (await report('CRITICAL')).body.data.event;
    const second = (await report('CRITICAL', { category: 'ELECTRICAL', description: 'Main drive tripping' })).body.data.event;
    expect((await resolve(first.id)).body.data.machine.status).toBe('DOWN');
    expect((await resolve(second.id)).body.data.machine.status).toBe('AVAILABLE');
  });

  it('two critical problems resolved at the same moment cannot leave the machine stuck DOWN', async () => {
    const first = (await report('CRITICAL')).body.data.event;
    const second = (await report('CRITICAL', { description: 'Second fault on the loom' })).body.data.event;
    const results = await Promise.all([resolve(first.id), resolve(second.id)]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await status()).toBe('AVAILABLE');
  });

  it('a running machine that goes DOWN comes back PAUSED (a person resumes the run)', async () => {
    await Machine.updateOne({ _id: loom.id }, { $set: { status: 'RUNNING' } });
    const critical = (await report('CRITICAL')).body.data.event;
    expect(critical).toMatchObject({ fromStatus: 'RUNNING', toStatus: 'DOWN' });
    expect((await resolve(critical.id)).body.data.machine.status).toBe('PAUSED');
  });

  it('a critical problem during maintenance takes it DOWN and repair returns it AVAILABLE', async () => {
    await act(floor, `/api/machines/${loom.id}/maintenance/start`);
    const critical = (await report('CRITICAL')).body.data.event;
    expect(await status()).toBe('DOWN');
    expect((await resolve(critical.id)).body.data.machine.status).toBe('AVAILABLE');
  });

  it('"pause production" pauses a RUNNING machine, and is refused when nothing is running', async () => {
    expect((await report('LOW', { pauseProduction: true })).body.error).toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { to: 'PAUSED' } });
    await Machine.updateOne({ _id: loom.id }, { $set: { status: 'RUNNING' } });
    expect((await report('LOW', { pauseProduction: true })).body.data.machine.status).toBe('PAUSED');
  });

  it('a problem can be resolved only once, and only on its own machine', async () => {
    const problem = (await report('LOW')).body.data.event;
    await resolve(problem.id);
    expect((await resolve(problem.id)).body.error.code).toBe('PROBLEM_ALREADY_RESOLVED');
    const other = (await request(app).post('/api/machines').set('Authorization', bearer(admin)).send({ code: 'W-04', name: 'Loom 4', type: 'WEAVING', ratedMetresPerHour: 15 })).body.data.machine;
    const res = await act(floor, `/api/machines/${other.id}/problems/${problem.id}/resolve`, { resolution: 'Wrong machine attempt' });
    expect(res.status).toBe(404);
  });

  it.each([
    ['an unknown category', { category: 'MAGIC' }],
    ['an unknown severity', { severity: 'HUGE' }],
    ['a too-short description', { description: 'no' }],
    ['negative downtime', { estimatedDowntimeMinutes: -5 }],
    ['a status field', { status: 'DOWN' }],
  ])('rejects %s (400)', async (_label, extra) => {
    expect((await report('LOW', extra)).status).toBe(400);
  });

  it('history is append-only and filterable by type and date', async () => {
    await report('LOW');
    const path = `/api/machines/${loom.id}/events`;
    expect((await get(floor, `${path}?type=PROBLEM_REPORTED`)).body.meta.total).toBe(1);
    expect((await get(floor, `${path}?from=${daysFromToday(1)}`)).body.meta.total).toBe(0);
    await expect(MachineEvent.updateOne({}, { $set: { note: 'rewrite' } })).rejects.toThrow(/append-only/);
  });
});

describe('access', () => {
  it('QC can view but not act; buyers and store keepers cannot view', async () => {
    expect((await get(qc, `/api/machines/${loom.id}`)).status).toBe(200);
    expect((await report('LOW', {}, qc)).status).toBe(403);
    for (const role of [ROLES.BUYER, ROLES.STORE_KEEPER]) {
      expect((await get(await createTestUser({ role }), '/api/machines')).status).toBe(403);
    }
  });

  it('only an ADMIN registers or edits machines', async () => {
    expect((await request(app).post('/api/machines').set('Authorization', bearer(floor)).send({ code: 'W-05', name: 'Loom 5', type: 'WEAVING', ratedMetresPerHour: 15 })).status).toBe(403);
  });
});

describe('seedDevMachines', () => {
  it('creates the dev machines once and never touches existing ones', async () => {
    await Machine.deleteMany({});
    const first = await seedDevMachines({ nodeEnv: 'development' });
    expect(first.every((row) => row.status === 'created')).toBe(true);
    await Machine.updateOne({ code: 'W-01' }, { $set: { status: 'MAINTENANCE' } });
    const second = await seedDevMachines({ nodeEnv: 'development' });
    expect(second.every((row) => row.status === 'exists')).toBe(true);
    expect((await Machine.findOne({ code: 'W-01' }).lean()).status).toBe('MAINTENANCE');
    await expect(seedDevMachines({ nodeEnv: 'production' })).rejects.toThrow(/refuses/);
  });
});
