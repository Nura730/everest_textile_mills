import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ROLES } from '../../src/constants/roles.js';
import { User } from '../../src/models/User.js';
import { bootstrapAdmin, BootstrapRefusedError } from '../../src/scripts/bootstrapAdmin.js';
import { Buyer } from '../../src/models/Buyer.js';
import { Product } from '../../src/models/Product.js';
import { DEV_BUYER, DEV_PRODUCTS, seedDevCatalog } from '../../src/scripts/seedDevCatalog.js';
import { DEV_USERS, seedDevUsers } from '../../src/scripts/seedDevUsers.js';
import { verifyPassword } from '../../src/services/password.service.js';
import { createTestUser } from '../helpers/auth.js';
import { clearCatalog, createTestBuyer, ensureCatalogCollections } from '../helpers/catalog.js';

const BACKEND_DIR = fileURLToPath(new URL('../..', import.meta.url));
const SEED_PASSWORD = 'Seed-Password-2026';

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI);
  await User.init();
  await ensureCatalogCollections();
});

afterEach(async () => {
  await User.deleteMany({});
  await clearCatalog();
});

afterAll(async () => {
  await disconnectDatabase();
});

function runScript(file, envOverrides) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { cwd: BACKEND_DIR, env: { ...process.env, ...envOverrides } });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    child.on('exit', (code) => resolve({ code, output }));
  });
}

describe('seedDevUsers', () => {
  it('creates one active user per role with the seed password', async () => {
    const report = await seedDevUsers({ nodeEnv: 'development', password: SEED_PASSWORD });

    expect(report.map((row) => row.status)).toEqual(['created', 'created', 'created', 'created', 'created']);
    const users = await User.find().select('+passwordHash').lean();
    expect(users.map((user) => user.role).sort()).toEqual(Object.values(ROLES).sort());
    for (const user of users) {
      expect(user.isActive).toBe(true);
      await expect(verifyPassword(SEED_PASSWORD, user.passwordHash)).resolves.toBe(true);
    }
  });

  it('is idempotent and never overwrites an existing password', async () => {
    await seedDevUsers({ nodeEnv: 'development', password: SEED_PASSWORD });
    const before = await User.findOne({ email: 'admin@everest.local' }).select('+passwordHash').lean();

    const report = await seedDevUsers({ nodeEnv: 'development', password: 'A-Different-Password' });

    expect(report.every((row) => row.status === 'exists')).toBe(true);
    expect(await User.countDocuments()).toBe(DEV_USERS.length);
    const after = await User.findOne({ email: 'admin@everest.local' }).select('+passwordHash').lean();
    expect(after.passwordHash).toBe(before.passwordHash);
  });

  it('refuses to run in production', async () => {
    await expect(seedDevUsers({ nodeEnv: 'production', password: SEED_PASSWORD })).rejects.toThrow(/refuses/);
    expect(await User.countDocuments()).toBe(0);
  });

  it('never includes passwords or hashes in its report', async () => {
    const report = await seedDevUsers({ nodeEnv: 'development', password: SEED_PASSWORD });
    expect(JSON.stringify(report)).not.toMatch(/Seed-Password|\$2[aby]\$/);
  });
});

describe('bootstrapAdmin', () => {
  const input = { name: 'Owner', email: 'owner@everest.test', password: 'Owner-Password-2026' };

  it('creates the first admin on an empty database', async () => {
    await expect(bootstrapAdmin(input)).resolves.toEqual({ email: 'owner@everest.test', role: 'ADMIN' });
    const admin = await User.findOne({ email: 'owner@everest.test' }).select('+passwordHash').lean();
    expect(admin.createdBy).toBeNull();
    await expect(verifyPassword('Owner-Password-2026', admin.passwordHash)).resolves.toBe(true);
  });

  it('refuses when an active admin exists', async () => {
    await createTestUser({ role: ROLES.ADMIN });
    await expect(bootstrapAdmin(input)).rejects.toThrow(BootstrapRefusedError);
    expect(await User.exists({ email: 'owner@everest.test' })).toBeNull();
  });

  it('works as a recovery path when only deactivated admins exist', async () => {
    await createTestUser({ role: ROLES.ADMIN, isActive: false });
    await expect(bootstrapAdmin(input)).resolves.toMatchObject({ role: 'ADMIN' });
  });

  it('never promotes an existing non-admin account', async () => {
    await createTestUser({ role: ROLES.BUYER, email: 'owner@everest.test' });
    await expect(bootstrapAdmin(input)).rejects.toThrow(/will not be promoted/);
    expect((await User.findOne({ email: 'owner@everest.test' }).lean()).role).toBe('BUYER');
  });
});

describe('CLI wrappers', () => {
  it('seed:dev exits 1 without SEED_PASSWORD and names the variable', async () => {
    const { code, output } = await runScript('scripts/seed-dev-users.js', { SEED_PASSWORD: '' });
    expect(code).toBe(1);
    expect(output).toMatch(/SEED_PASSWORD/);
  });

  it('seed:dev exits 1 in production before touching the database', async () => {
    const { code, output } = await runScript('scripts/seed-dev-users.js', {
      NODE_ENV: 'production',
      BCRYPT_ROUNDS: '10',
      SEED_PASSWORD,
    });
    expect(code).toBe(1);
    expect(output).toMatch(/refuses to run with NODE_ENV=production/);
    expect(await User.countDocuments()).toBe(0);
  });

  it('seed:dev creates the users and prints emails but no password', async () => {
    const { code, output } = await runScript('scripts/seed-dev-users.js', { SEED_PASSWORD });

    expect(code).toBe(0);
    expect(output).toContain('admin@everest.local');
    expect(output).not.toContain(SEED_PASSWORD);
    expect(await User.countDocuments()).toBe(DEV_USERS.length);
  });

  it('bootstrap:admin creates an admin and refuses a second run', async () => {
    const env = {
      BOOTSTRAP_ADMIN_NAME: 'Owner',
      BOOTSTRAP_ADMIN_EMAIL: 'owner@everest.test',
      BOOTSTRAP_ADMIN_PASSWORD: 'Owner-Password-2026',
    };
    const first = await runScript('scripts/bootstrap-admin.js', env);
    const second = await runScript('scripts/bootstrap-admin.js', { ...env, BOOTSTRAP_ADMIN_EMAIL: 'other@everest.test' });

    expect(first.code).toBe(0);
    expect(first.output).not.toContain('Owner-Password-2026');
    expect(second.code).toBe(1);
    expect(second.output).toMatch(/Refused: An active admin already exists/);
    expect(await User.countDocuments({ role: 'ADMIN' })).toBe(1);
  });
});

describe('seedDevCatalog', () => {
  it('creates the dev buyer company and products, and links the dev buyer account', async () => {
    await seedDevUsers({ nodeEnv: 'development', password: SEED_PASSWORD });
    const report = await seedDevCatalog({ nodeEnv: 'development' });

    expect(report.map((row) => row.status)).toEqual(['created', 'created', 'created', 'created']);
    const buyer = await Buyer.findOne({ code: DEV_BUYER.code }).lean();
    const buyerUser = await User.findOne({ email: 'buyer@everest.local' }).lean();
    expect(String(buyerUser.buyerId)).toBe(String(buyer._id));
    expect(await Product.countDocuments()).toBe(DEV_PRODUCTS.length);
  });

  it('is idempotent and never re-links a buyer account that already has a company', async () => {
    await seedDevUsers({ nodeEnv: 'development', password: SEED_PASSWORD });
    const other = await createTestBuyer();
    await User.updateOne({ email: 'buyer@everest.local' }, { buyerId: other._id });

    await seedDevCatalog({ nodeEnv: 'development' });
    const second = await seedDevCatalog({ nodeEnv: 'development' });

    expect(second.every((row) => row.status === 'exists')).toBe(true);
    expect(String((await User.findOne({ email: 'buyer@everest.local' }).lean()).buyerId)).toBe(String(other._id));
    expect(await Buyer.countDocuments({ code: DEV_BUYER.code })).toBe(1);
  });

  it('refuses to run in production', async () => {
    await expect(seedDevCatalog({ nodeEnv: 'production' })).rejects.toThrow(/refuses/);
    expect(await Buyer.countDocuments()).toBe(0);
  });

  it('seeds products whose yarn spec passes the catalog rule (yarn >= fabric weight)', () => {
    for (const product of DEV_PRODUCTS) {
      expect(product.yarnGramsPerMetre).toBeGreaterThanOrEqual(Math.floor((product.gsm * product.widthCm) / 100));
    }
  });
});
