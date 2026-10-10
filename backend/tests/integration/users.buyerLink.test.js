import request from 'supertest';
import { createApp } from '../../src/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { AuditLog } from '../../src/models/AuditLog.js';
import { User } from '../../src/models/User.js';
import { TEST_PASSWORD, bearer, captureLogs, createTestUser } from '../helpers/auth.js';
import { clearCatalog, createTestBuyer, ensureCatalogCollections } from '../helpers/catalog.js';

let app;
let admin;
let buyerCo;

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await Promise.all([User.init(), ensureCatalogCollections()]);
});

beforeEach(async () => {
  app = createApp({ logger: captureLogs('silent').logger });
  admin = await createTestUser({ role: ROLES.ADMIN });
  buyerCo = await createTestBuyer();
});

afterEach(async () => {
  await clearCatalog();
  await User.deleteMany({});
  // Account changes are audited (Phase 13); the trail is cleared around the append-only model.
  await AuditLog.collection.deleteMany({});
});

afterAll(async () => {
  await disconnectDatabase();
});

const createUser = (body) => request(app).post('/api/users').set('Authorization', bearer(admin)).send(body);
const base = { name: 'Priya Shah', email: 'priya@surat.example', password: TEST_PASSWORD };

describe('POST /api/users — buyer company link', () => {
  it('links a BUYER account to its company and exposes buyerId', async () => {
    const res = await createUser({ ...base, role: ROLES.BUYER, buyerId: String(buyerCo._id) });

    expect(res.status).toBe(201);
    expect(res.body.data.user.buyerId).toBe(String(buyerCo._id));
  });

  it('requires buyerId for role BUYER', async () => {
    const res = await createUser({ ...base, role: ROLES.BUYER });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'buyerId', message: 'is required for role BUYER' })]);
  });

  it('rejects buyerId for any other role', async () => {
    const res = await createUser({ ...base, role: ROLES.STORE_KEEPER, buyerId: String(buyerCo._id) });
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'buyerId', message: 'is only allowed for role BUYER' })]);
  });

  it('returns 400 for a company that does not exist, and creates no account', async () => {
    const res = await createUser({ ...base, role: ROLES.BUYER, buyerId: '64b7f0c2a1b2c3d4e5f60718' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ location: 'body', path: 'buyerId', message: 'does not exist' }]);
    expect(await User.countDocuments({ email: base.email })).toBe(0);
  });

  it('returns 409 BUYER_INACTIVE for an inactive company', async () => {
    const inactive = await createTestBuyer({ isActive: false });
    const res = await createUser({ ...base, role: ROLES.BUYER, buyerId: String(inactive._id) });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BUYER_INACTIVE');
  });

  it('includes buyerId on /auth/me (null for staff)', async () => {
    const buyer = await createTestUser({ role: ROLES.BUYER, buyerId: buyerCo._id });
    const me = await request(app).get('/api/auth/me').set('Authorization', bearer(buyer));
    const adminMe = await request(app).get('/api/auth/me').set('Authorization', bearer(admin));

    expect(me.body.data.user.buyerId).toBe(String(buyerCo._id));
    expect(adminMe.body.data.user.buyerId).toBeNull();
  });
});
