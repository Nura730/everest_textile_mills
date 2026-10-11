import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { Dispatch } from '../../src/models/Fulfilment.js';
import { Machine } from '../../src/models/Machine.js';
import { ProductionRun } from '../../src/models/ProductionRun.js';
import { Roll } from '../../src/models/Roll.js';
import { User } from '../../src/models/User.js';
import { bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { clearCatalog, createTestBuyer, createTestOrder, createTestProduct, daysFromToday, ensureCatalogCollections } from '../helpers/catalog.js';
import { clearInventory, ensureInventoryCollections } from '../helpers/inventory.js';

let app;
let users;
let buyerCo;
let product;
let admin;

const attention = async (actor) => (await request(app).get('/api/summary/attention').set('Authorization', bearer(actor))).body.data;
const keys = (data) => data.alerts.map((a) => a.key.replace(/-[a-f0-9]{24}$/, '')).sort();

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await ensureCatalogCollections();
  await ensureInventoryCollections();
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
  buyerCo = await createTestBuyer();
  product = await createTestProduct();
  users = {
    admin,
    store: await createTestUser({ role: ROLES.STORE_KEEPER }),
    floor: await createTestUser({ role: ROLES.FLOOR_MANAGER }),
    qc: await createTestUser({ role: ROLES.QC_INSPECTOR }),
    buyer: await createTestUser({ role: ROLES.BUYER, buyerId: buyerCo._id }),
    otherBuyer: await createTestUser({ role: ROLES.BUYER, buyerId: (await createTestBuyer())._id }),
  };
  // Facts on the floor
  await createTestOrder({ buyer: buyerCo, product, createdBy: admin._id }); // waiting for confirmation
  await createTestOrder({ buyer: buyerCo, product, createdBy: admin._id, status: 'CONFIRMED' }); // no yarn at all → blocked
  const running = await createTestOrder({ buyer: buyerCo, product, createdBy: admin._id, status: 'IN_PRODUCTION', quantityCm: 500_000, requiredBy: new Date(`${daysFromToday(3)}T00:00:00Z`) });
  const loom = await Machine.create({ code: 'W-A1', name: 'Loom', type: 'WEAVING', ratedCmPerHour: 1000, status: 'PAUSED' });
  await Machine.create({ code: 'W-A2', name: 'Loom 2', type: 'WEAVING', ratedCmPerHour: 1000, status: 'DOWN' });
  const run = await ProductionRun.create({ runNumber: 'RUN-A-1', orderId: running._id, orderNumber: running.orderNumber, machineId: loom._id, machineCode: 'W-A1', targetCm: 500_000, status: 'PAUSED', supervisorId: admin._id });
  const base = { orderId: running._id, orderNumber: running.orderNumber, runId: run._id, runNumber: run.runNumber, machineId: loom._id, machineCode: 'W-A1', producedBy: admin._id };
  await Roll.create({ ...base, rollNumber: 'ROLL-A-1', lengthCm: 10_000, status: 'QC_PENDING' });
  await Roll.create({ ...base, rollNumber: 'ROLL-A-2', lengthCm: 10_000, status: 'IN_REWORK', reworkCount: 1 });
  await Dispatch.collection.insertOne({ dispatchNumber: 'DSP-A-1', orderId: running._id, orderNumber: running.orderNumber, buyerId: buyerCo._id, buyerName: 'B', lines: [], totalLengthCm: 10_000, preparedBy: admin._id, status: 'PREPARED', createdAt: new Date() });
});

afterEach(async () => {
  await clearCatalog();
  await clearInventory();
  await User.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('GET /api/summary/attention', () => {
  it('QC sees inspections and holds only, with badge counts from real rolls', async () => {
    const data = await attention(users.qc);
    expect(keys(data)).toEqual(['qc-pending', 'qc-rework']);
    expect(data.badges).toEqual({ '/quality': 1 });
    expect(data.alerts.find((a) => a.key === 'qc-rework')).toMatchObject({ priority: 'HIGH', why: expect.stringContaining('already went through rework') });
  });

  it('the store keeper sees shortages, dispatches awaiting signature and delivery risk; no QC, no machines', async () => {
    const data = await attention(users.store);
    expect(keys(data)).toEqual(expect.arrayContaining(['material-shortage', 'dispatch-awaiting-signature']));
    expect(keys(data)).not.toEqual(expect.arrayContaining(['qc-pending']));
    expect(data.badges['/dispatch']).toBe(1);
    expect(data.alerts.find((a) => a.key === 'material-shortage').action).toMatch(/^Receive the missing yarn/);
  });

  it('the floor manager sees material, rework, machines and paused runs', async () => {
    const data = await attention(users.floor);
    expect(keys(data)).toEqual(expect.arrayContaining(['material-shortage', 'qc-rework', 'machines-stopped', 'runs-paused']));
    expect(keys(data)).not.toEqual(expect.arrayContaining(['dispatch-awaiting-signature', 'orders-to-confirm', 'qc-pending']));
    expect(data.badges).toMatchObject({ '/machines': 1, '/production': 1, '/quality': 1 });
    expect(data.alerts[0].priority).toBe('HIGH'); // sorted by priority
  });

  it('the admin also sees orders to confirm and the delivery risk', async () => {
    const data = await attention(users.admin);
    expect(keys(data)).toEqual(expect.arrayContaining(['orders-to-confirm', 'risk']));
    expect(data.badges['/orders']).toBe(1);
  });

  it('a NEW order short of yarn is routed to the store keeper (not only to the admin who confirms)', async () => {
    const data = await attention(users.store);
    const shortage = data.alerts.find((a) => a.key === 'material-shortage');
    // fixtures: one new (ORDER_CREATED) and one confirmed order, both with no yarn in stock
    expect(shortage.title).toBe('2 order(s) blocked by a yarn shortage');
    expect(shortage.affected).toHaveLength(2);
    const admin = (await attention(users.admin)).alerts.find((a) => a.key === 'material-shortage');
    expect(admin.action).toMatch(/store keeper resolves it/);
    // the floor is not asked to reserve a NEW order (it is not confirmed yet)
    expect((await attention(users.floor)).alerts.find((a) => a.key === 'ready-to-reserve')).toBeUndefined();
  });

  it('a buyer sees only their own orders, in plain words; another buyer sees nothing of them', async () => {
    const mine = await attention(users.buyer);
    expect(mine.alerts.length).toBeGreaterThan(0);
    expect(JSON.stringify(mine)).not.toMatch(/W-A1|RUN-A|ROLL-A|DSP-A|kg/);
    expect((await attention(users.otherBuyer)).alerts).toEqual([]);
  });
});
