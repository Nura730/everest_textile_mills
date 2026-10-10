import { connectDatabase, disconnectDatabase } from '../../src/config/db.js';
import { ALL_ROLES, ROLES, isRole } from '../../src/constants/roles.js';
import { normalizeError } from '../../src/middleware/errorHandler.js';
import { User, toPublicUser } from '../../src/models/User.js';

// Shaped like a real bcrypt hash so leak assertions match what production would store.
const FAKE_HASH = `$2b$04$${'a'.repeat(53)}`;

function userData(overrides = {}) {
  return {
    name: 'Ravi Kumar',
    email: 'ravi@everest.local',
    passwordHash: FAKE_HASH,
    role: ROLES.STORE_KEEPER,
    ...overrides,
  };
}

describe('roles', () => {
  it('defines exactly the five factory roles', () => {
    expect([...ALL_ROLES].sort()).toEqual(['ADMIN', 'BUYER', 'FLOOR_MANAGER', 'QC_INSPECTOR', 'STORE_KEEPER']);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(ROLES)).toBe(true);
    expect(Object.isFrozen(ALL_ROLES)).toBe(true);
  });

  it('recognises valid roles only', () => {
    expect(isRole('ADMIN')).toBe(true);
    expect(isRole('admin')).toBe(false);
    expect(isRole('SUPERUSER')).toBe(false);
  });
});

describe('User model', () => {
  beforeAll(async () => {
    await connectDatabase(process.env.MONGODB_URI);
    // Build the unique email index before the duplicate tests rely on it.
    await User.init();
  });

  afterEach(async () => {
    await User.deleteMany({});
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it('applies defaults', async () => {
    const user = await User.create(userData());

    expect(user.isActive).toBe(true);
    expect(user.tokenVersion).toBe(0);
    expect(user.lastLoginAt).toBeNull();
    expect(user.createdBy).toBeNull();
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it('lowercases and trims the email', async () => {
    const user = await User.create(userData({ email: '  Ravi@Everest.LOCAL ' }));
    expect(user.email).toBe('ravi@everest.local');
  });

  it.each([
    ['an unknown role', { role: 'SUPERUSER' }, 'role'],
    ['a lowercase role', { role: 'admin' }, 'role'],
    ['a malformed email', { email: 'not-an-email' }, 'email'],
    ['a one-letter name', { name: 'R' }, 'name'],
    ['a missing password hash', { passwordHash: undefined }, 'passwordHash'],
  ])('rejects %s', async (_label, overrides, field) => {
    await expect(User.create(userData(overrides))).rejects.toMatchObject({
      name: 'ValidationError',
      errors: { [field]: expect.anything() },
    });
  });

  describe('password hash protection', () => {
    it('excludes passwordHash from queries by default', async () => {
      await User.create(userData());

      const doc = await User.findOne({ email: 'ravi@everest.local' });
      const lean = await User.findOne({ email: 'ravi@everest.local' }).lean();

      expect(doc.passwordHash).toBeUndefined();
      expect(lean).not.toHaveProperty('passwordHash');
    });

    it('returns passwordHash only when explicitly selected', async () => {
      await User.create(userData());
      const user = await User.findOne({ email: 'ravi@everest.local' }).select('+passwordHash');

      expect(user.passwordHash).toBe(FAKE_HASH);
    });

    it('strips passwordHash and tokenVersion from JSON even when loaded', async () => {
      await User.create(userData());
      const user = await User.findOne({ email: 'ravi@everest.local' }).select('+passwordHash');
      const json = JSON.parse(JSON.stringify(user));

      expect(json).not.toHaveProperty('passwordHash');
      expect(json).not.toHaveProperty('tokenVersion');
      expect(json).not.toHaveProperty('_id');
      expect(json).not.toHaveProperty('__v');
      expect(json.id).toBe(String(user._id));
      expect(JSON.stringify(user)).not.toContain('$2b$');
    });

    it('strips passwordHash from JSON of a freshly created document', async () => {
      const created = await User.create(userData());
      expect(JSON.stringify(created)).not.toContain('$2b$');
    });
  });

  describe('toPublicUser', () => {
    const PUBLIC_KEYS = ['createdAt', 'email', 'id', 'isActive', 'lastLoginAt', 'name', 'role'];

    it('returns only allowlisted fields from a hash-loaded document', async () => {
      await User.create(userData());
      const user = await User.findOne({ email: 'ravi@everest.local' }).select('+passwordHash');
      const publicUser = toPublicUser(user);

      expect(Object.keys(publicUser).sort()).toEqual(PUBLIC_KEYS);
      expect(publicUser).toMatchObject({ name: 'Ravi Kumar', email: 'ravi@everest.local', role: 'STORE_KEEPER' });
      expect(publicUser.id).toBe(String(user._id));
    });

    it('works on lean objects', async () => {
      const created = await User.create(userData());
      const lean = await User.findById(created._id).select('+passwordHash +tokenVersion').lean();

      expect(Object.keys(toPublicUser(lean)).sort()).toEqual(PUBLIC_KEYS);
      expect(JSON.stringify(toPublicUser(lean))).not.toContain('$2b$');
    });
  });

  describe('unique email', () => {
    it('rejects a duplicate email, case-insensitively', async () => {
      await User.create(userData());
      const error = await User.create(userData({ email: 'RAVI@everest.local', name: 'Other' })).catch((e) => e);

      expect(error.code).toBe(11000);
    });

    it('maps the duplicate to 409 DUPLICATE_RESOURCE naming only the field', async () => {
      await User.create(userData());
      const error = await User.create(userData()).catch((e) => e);
      const appError = normalizeError(error);

      expect(appError).toMatchObject({ code: 'DUPLICATE_RESOURCE', status: 409, details: { fields: ['email'] } });
      expect(JSON.stringify(appError.details)).not.toContain('ravi@everest.local');
    });
  });
});
