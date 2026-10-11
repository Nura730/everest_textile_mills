import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { Attendance } from '../../src/models/Attendance.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { IdempotencyRecord } from '../../src/models/IdempotencyRecord.js';
import { SyncEvent } from '../../src/models/SyncEvent.js';
import { User } from '../../src/models/User.js';
import { Worker } from '../../src/models/Worker.js';
import { addDaysToDateString, todayInIndia } from '../../src/utils/dates.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { newKey } from '../helpers/inventory.js';

let app;
let admin;
let floor;
let qc;
let store;
let buyer;
let weaver; // daily ₹600
let helper; // hourly ₹90

const today = todayInIndia();
const daysAgo = (n) => addDaysToDateString(today, -n);
const get = (actor, path) => request(app).get(path).set('Authorization', bearer(actor));
const post = (actor, path, body, key = newKey()) => request(app).post(path).set('Authorization', bearer(actor)).set('Idempotency-Key', key).send(body);
const patch = (actor, path, body) => request(app).patch(path).set('Authorization', bearer(actor)).send(body);
const mark = (worker, status, extra = {}, actor = floor, key) => post(actor, '/api/attendance', { workerId: worker.id, date: today, status, ...extra }, key);

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await Promise.all([User.init(), Worker.init(), Attendance.init(), IdempotencyRecord.init(), SyncEvent.init(), AuditLog.createCollection()]);
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
  floor = await createTestUser({ role: ROLES.FLOOR_MANAGER });
  qc = await createTestUser({ role: ROLES.QC_INSPECTOR });
  store = await createTestUser({ role: ROLES.STORE_KEEPER });
  buyer = await createTestUser({ role: ROLES.BUYER });
  weaver = (await post(admin, '/api/workers', { code: 'wk-001', name: 'Ravi Kumar', department: 'WEAVING', wageBasis: 'DAILY', ratePaise: 60_000 })).body.data.worker;
  helper = (await post(admin, '/api/workers', { code: 'WK-002', name: 'Meena S', department: 'DYEING', wageBasis: 'HOURLY', ratePaise: 9_000 })).body.data.worker;
});

afterEach(async () => {
  await Promise.all([Worker.deleteMany({}), Attendance.deleteMany({}), AuditLog.collection.deleteMany({}), IdempotencyRecord.deleteMany({}), SyncEvent.collection.deleteMany({}), User.deleteMany({})]);
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('workers', () => {
  it('the admin registers workers with a unique code and wage terms; others read them without rates', async () => {
    expect(weaver).toMatchObject({ code: 'WK-001', department: 'WEAVING', wageBasis: 'DAILY', ratePaise: 60_000, isActive: true });
    const dup = await post(admin, '/api/workers', { code: 'WK-001', name: 'Someone Else', department: 'GENERAL', wageBasis: 'DAILY', ratePaise: 1 });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_RESOURCE');
    expect((await post(admin, '/api/workers', { code: 'WK-9', name: 'Bad Rate', department: 'GENERAL', wageBasis: 'DAILY', ratePaise: -1 })).status).toBe(400);
    expect((await post(floor, '/api/workers', { code: 'WK-3', name: 'Not Allowed', department: 'GENERAL', wageBasis: 'DAILY', ratePaise: 1 })).status).toBe(403);
    const seenByFloor = (await get(floor, '/api/workers')).body.data.workers;
    expect(seenByFloor).toHaveLength(2);
    expect(seenByFloor[0].ratePaise).toBeUndefined();
    for (const actor of [store, buyer]) expect((await get(actor, '/api/workers')).status).toBe(403);
    expect(await AuditLog.countDocuments({ action: 'WORKER_CREATED' })).toBe(2);
  });

  it('a rate change applies to new entries only (each entry keeps the terms it was paid at)', async () => {
    await mark(weaver, 'PRESENT', { date: daysAgo(1) });
    const fresh = (await get(admin, `/api/workers/${weaver.id}`)).body.data.worker;
    expect((await patch(admin, `/api/workers/${weaver.id}`, { ratePaise: 70_000, expectedUpdatedAt: fresh.updatedAt })).body.data.worker.ratePaise).toBe(70_000);
    await mark(weaver, 'PRESENT');
    const wages = (await get(admin, `/api/attendance?workerId=${weaver.id}`)).body.data.attendance.map((a) => a.wagePaise).sort();
    expect(wages).toEqual([60_000, 70_000]);
    expect((await patch(admin, `/api/workers/${weaver.id}`, { ratePaise: 1, expectedUpdatedAt: fresh.updatedAt })).status).toBe(409); // stale
  });
});

describe('attendance register', () => {
  it('records present, half day and absent with server-computed wages; one entry per worker per day', async () => {
    const res = await mark(weaver, 'HALF_DAY');
    expect(res.status).toBe(201);
    expect(res.body.data.attendance).toMatchObject({ status: 'HALF_DAY', hours: null });
    expect(res.body.data.attendance.wagePaise).toBeUndefined(); // the floor manager does not see money
    expect((await Attendance.findOne({ workerId: weaver.id }).lean()).wagePaise).toBe(30_000);
    const again = await mark(weaver, 'PRESENT');
    expect(again.status).toBe(409);
    expect(again.body.error).toMatchObject({ code: 'DUPLICATE_RESOURCE', details: { attendanceId: res.body.data.attendance.id } });
    expect((await mark(helper, 'PRESENT', { hours: 7.5 }, admin)).body.data.attendance).toMatchObject({ hours: 7.5, wagePaise: 67_500 });
    expect(await Attendance.countDocuments()).toBe(2);
  });

  it('validates hours, dates and wage basis; a retry with the same key replays', async () => {
    expect((await mark(helper, 'PRESENT')).status).toBe(400); // hourly needs hours
    expect((await mark(weaver, 'PRESENT', { hours: 8 })).status).toBe(400); // daily has no hours
    expect((await mark(helper, 'PRESENT', { hours: 25 })).status).toBe(400);
    expect((await mark(weaver, 'PRESENT', { date: addDaysToDateString(today, 1) })).status).toBe(400); // future
    expect((await mark(weaver, 'LATE')).status).toBe(400);
    const key = newKey();
    expect((await mark(weaver, 'PRESENT', {}, floor, key)).status).toBe(201);
    expect((await mark(weaver, 'PRESENT', {}, floor, key)).headers['idempotent-replayed']).toBe('true');
    expect(await AuditLog.countDocuments({ action: 'ATTENDANCE_RECORDED' })).toBe(1);
  });

  it('roles: floor and admin record; QC only reads; store keeper and buyer have no access', async () => {
    expect((await mark(weaver, 'PRESENT', {}, qc)).status).toBe(403);
    expect((await mark(weaver, 'PRESENT', {}, store)).status).toBe(403);
    expect((await mark(weaver, 'PRESENT', {}, buyer)).status).toBe(403);
    await mark(weaver, 'PRESENT');
    expect((await get(qc, `/api/attendance/register?date=${today}`)).status).toBe(200);
    for (const actor of [store, buyer]) expect((await get(actor, `/api/attendance?date=${today}`)).status).toBe(403);
  });

  it('corrections need a reason, recompute the wage, keep before/after; the floor only corrects recent days', async () => {
    const entry = (await mark(weaver, 'PRESENT')).body.data.attendance;
    expect((await patch(floor, `/api/attendance/${entry.id}`, { status: 'HALF_DAY', expectedUpdatedAt: entry.updatedAt })).status).toBe(400); // reason
    expect((await patch(qc, `/api/attendance/${entry.id}`, { status: 'HALF_DAY', reason: 'Left after lunch', expectedUpdatedAt: entry.updatedAt })).status).toBe(403);
    const fixed = await patch(floor, `/api/attendance/${entry.id}`, { status: 'HALF_DAY', reason: 'Left after lunch', expectedUpdatedAt: entry.updatedAt });
    expect(fixed.status).toBe(200);
    expect(fixed.body.data.attendance.corrections).toEqual([expect.objectContaining({ byRole: 'FLOOR_MANAGER', reason: 'Left after lunch', before: expect.objectContaining({ status: 'PRESENT' }), after: expect.objectContaining({ status: 'HALF_DAY' }) })]);
    expect((await Attendance.findById(entry.id).lean()).wagePaise).toBe(30_000);
    expect((await patch(floor, `/api/attendance/${entry.id}`, { status: 'ABSENT', reason: 'Second try', expectedUpdatedAt: entry.updatedAt })).status).toBe(409); // stale copy
    expect(await AuditLog.findOne({ action: 'ATTENDANCE_CORRECTED' }).lean()).toMatchObject({ before: { status: 'PRESENT', wagePaise: 60_000 }, after: { status: 'HALF_DAY', wagePaise: 30_000 } });
    // the floor manager sees the correction in the audit trail, without the money
    const seen = (await get(floor, '/api/audit?action=ATTENDANCE_CORRECTED')).body.data.entries;
    expect(seen).toHaveLength(1);
    expect(JSON.stringify(seen[0])).not.toMatch(/wagePaise|30000|60000/);

    const old = (await mark(weaver, 'PRESENT', { date: daysAgo(10) })).body.data.attendance;
    const late = await patch(floor, `/api/attendance/${old.id}`, { status: 'ABSENT', reason: 'Was on leave that day', expectedUpdatedAt: old.updatedAt });
    expect(late.status).toBe(403);
    expect(late.body.error.details.reason).toBe('CORRECTION_WINDOW_PASSED');
    expect((await patch(admin, `/api/attendance/${old.id}`, { status: 'ABSENT', reason: 'Was on leave that day', expectedUpdatedAt: old.updatedAt })).body.data.attendance.wagePaise).toBe(0);
  });

  it('the day register lists every active worker with their entry or a gap; filters work', async () => {
    await mark(weaver, 'PRESENT');
    const register = (await get(floor, `/api/attendance/register?date=${today}`)).body.data;
    expect(register.totals).toMatchObject({ workers: 2, recorded: 1, present: 1, notRecorded: 1 });
    expect(register.rows.find((r) => r.worker.id === helper.id).attendance).toBeNull();
    expect((await get(floor, `/api/attendance/register?date=${today}&department=DYEING`)).body.data.rows).toHaveLength(1);
    expect((await get(floor, `/api/attendance?from=${daysAgo(3)}&to=${today}&status=PRESENT`)).body.meta.total).toBe(1);
  });

  it('works offline: queued entries replay once; a duplicate day is a CONFLICT, not a second wage', async () => {
    const recordedAt = new Date(Date.now() - 600_000).toISOString();
    const first = { eventId: randomUUID(), type: 'ATTENDANCE_RECORD', payload: { workerId: weaver.id, date: today, status: 'PRESENT' }, recordedAt };
    const send = (events) => request(app).post('/api/sync/events').set('Authorization', bearer(floor)).send({ deviceId: 'tablet-hr', events });
    expect((await send([first])).body.data.results[0].outcome).toBe('APPLIED');
    expect((await send([first])).body.data.results[0].outcome).toBe('DUPLICATE'); // the device resent it
    expect((await Attendance.findOne({ workerId: weaver.id }).lean()).source).toBe('OFFLINE');
    const second = { eventId: randomUUID(), type: 'ATTENDANCE_RECORD', payload: { workerId: weaver.id, date: today, status: 'ABSENT' }, recordedAt };
    const res2 = await request(app).post('/api/sync/events').set('Authorization', bearer(floor)).send({ deviceId: 'tablet-hr', events: [second] });
    expect(res2.body.data.results[0]).toMatchObject({ outcome: 'CONFLICT', error: { code: 'DUPLICATE_RESOURCE' } });
    expect(await Attendance.countDocuments()).toBe(1);
  });
});

describe('wages', () => {
  it('summarises a period by worker and department (admin only); labour shows as a separate factory expense', async () => {
    await mark(weaver, 'PRESENT', { date: daysAgo(2) });
    await mark(weaver, 'HALF_DAY', { date: daysAgo(1) });
    await mark(weaver, 'ABSENT');
    await mark(helper, 'PRESENT', { hours: 8 });
    const summary = (await get(admin, `/api/wages/summary?from=${daysAgo(6)}&to=${today}`)).body.data;
    expect(summary.totalPaise).toBe(60_000 + 30_000 + 0 + 72_000);
    expect(summary.byWorker.find((w) => w.workerCode === 'WK-001')).toMatchObject({ present: 1, halfDay: 1, absent: 1, wagePaise: 90_000 });
    expect(summary.byWorker.find((w) => w.workerCode === 'WK-002')).toMatchObject({ hours: 8, wagePaise: 72_000 });
    expect(summary.byDepartment).toEqual([expect.objectContaining({ department: 'WEAVING', wagePaise: 90_000 }), expect.objectContaining({ department: 'DYEING', wagePaise: 72_000 })]);
    // labour from the register is shown next to order profit, never inside order cost
    const expenses = (await get(admin, '/api/costing/summary')).body.data.factoryExpenses;
    expect(expenses.wages).toMatchObject({ totalPaise: expect.any(Number), allocation: expect.stringMatching(/Not allocated/) });
    for (const actor of [floor, qc, store, buyer]) expect((await get(actor, `/api/wages/summary?from=${daysAgo(6)}&to=${today}`)).status).toBe(403);
    expect((await get(admin, `/api/wages/summary?from=${today}&to=${daysAgo(1)}`)).status).toBe(400);
  });
});
