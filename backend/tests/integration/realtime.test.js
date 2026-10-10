import { createServer } from 'node:http';
import { io as connect } from 'socket.io-client';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { recordAudit } from '../../src/audit/recordAudit.js';
import { attachRealtime } from '../../src/realtime/socket.js';
import { User } from '../../src/models/User.js';
import { runInTransaction } from '../../src/utils/transaction.js';
import { captureLogs, createTestUser, tokenFor } from '../helpers/auth.js';
import { clearCatalog, createTestBuyer, createTestOrder, createTestProduct, ensureCatalogCollections } from '../helpers/catalog.js';
import { clearInventory, ensureInventoryCollections } from '../helpers/inventory.js';

let server;
let realtime;
let url;
let admin;
let sockets = [];

function open(user, token = tokenFor(user)) {
  const socket = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false, forceNew: true });
  sockets.push(socket);
  const received = [];
  socket.on('activity', (entry) => received.push(entry));
  const ready = new Promise((resolve, reject) => {
    socket.on('ready', resolve);
    socket.on('connect_error', (err) => reject(err));
  });
  return { socket, received, ready };
}

const audit = (fields, actor = admin) =>
  runInTransaction((session) => recordAudit({ entityType: 'Thing', entityId: actor._id, ...fields }, { actor: { id: String(actor._id), role: actor.role }, source: 'ONLINE' }, session));

const waitUntil = async (check, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out');
};

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await ensureCatalogCollections();
  await ensureInventoryCollections();
  server = createServer(createApp({ logger: captureLogs('silent').logger }));
  realtime = attachRealtime(server, { corsOrigins: ['http://localhost:5173'] });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
  admin = await createTestUser({ role: ROLES.ADMIN, name: 'Asha Admin' });
});

afterEach(async () => {
  sockets.forEach((s) => s.disconnect());
  sockets = [];
  await clearCatalog();
  await clearInventory();
  await User.deleteMany({});
});

afterAll(async () => {
  await realtime.close();
  await new Promise((resolve) => server.close(resolve));
  await disconnectDatabase();
});

describe('live updates', () => {
  it('refuses a socket without a valid token', async () => {
    await expect(open(admin, 'garbage').ready).rejects.toThrow(/UNAUTHENTICATED/);
    await User.updateOne({ _id: admin._id }, { $inc: { tokenVersion: 1 } });
    await expect(open(admin).ready).rejects.toThrow(/UNAUTHENTICATED/);
  });

  it('pushes committed changes to the roles allowed to see them, in their audit-center shape', async () => {
    const floor = await createTestUser({ role: ROLES.FLOOR_MANAGER });
    const store = await createTestUser({ role: ROLES.STORE_KEEPER });
    const a = open(admin);
    const f = open(floor);
    const s = open(store);
    await Promise.all([a.ready, f.ready, s.ready]);

    await audit({ action: 'MATERIAL_RECEIVED', after: { lotNumber: 'GRN-9', costPerKgPaise: 32_000 } });
    await audit({ action: 'MACHINE_PROBLEM_REPORTED', machineId: admin._id });
    await waitUntil(() => a.received.length === 2 && s.received.length === 1 && f.received.length === 1);

    expect(a.received.map((e) => e.action)).toEqual(['MATERIAL_RECEIVED', 'MACHINE_PROBLEM_REPORTED']);
    expect(a.received[0]).toMatchObject({ actorName: 'Asha Admin', after: { costPerKgPaise: 32_000 } });
    expect(s.received[0]).toMatchObject({ action: 'MATERIAL_RECEIVED', after: { lotNumber: 'GRN-9' } });
    expect(s.received[0].after.costPerKgPaise).toBeUndefined();
    expect(f.received[0].action).toBe('MACHINE_PROBLEM_REPORTED');
  });

  it('never announces a change that rolled back', async () => {
    const a = open(admin);
    await a.ready;
    await expect(runInTransaction(async (session) => {
      await recordAudit({ action: 'STOCK_ADJUSTED', entityType: 'YarnLot', entityId: admin._id }, { actor: { id: String(admin._id), role: 'ADMIN' } }, session);
      throw new Error('business rule failed');
    })).rejects.toThrow('business rule failed');
    await audit({ action: 'MARKER' });
    await waitUntil(() => a.received.length >= 1);
    expect(a.received.map((e) => e.action)).toEqual(['MARKER']);
  });

  it('sends a buyer only milestones of their own company\'s orders', async () => {
    const mine = await createTestBuyer();
    const theirs = await createTestBuyer();
    const product = await createTestProduct();
    const myOrder = await createTestOrder({ buyer: mine, product, createdBy: admin._id });
    const otherOrder = await createTestOrder({ buyer: theirs, product, createdBy: admin._id });
    const b = open(await createTestUser({ role: ROLES.BUYER, buyerId: mine._id }));
    await b.ready;

    await audit({ action: 'RUN_STARTED', orderId: otherOrder._id });
    await audit({ action: 'MATERIAL_ISSUED', orderId: myOrder._id });
    await audit({ action: 'RUN_STARTED', orderId: myOrder._id });
    await waitUntil(() => b.received.length >= 1);
    await new Promise((r) => setTimeout(r, 300));
    expect(b.received).toEqual([{ id: expect.any(String), action: 'RUN_STARTED', label: 'Production started', orderId: String(myOrder._id), at: expect.any(String) }]);
  });
});
