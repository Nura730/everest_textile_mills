import {
  MAX_PASSWORD_BYTES,
  hashPassword,
  passwordByteLength,
  verifyAgainstDummyHash,
  verifyPassword,
} from '../../src/services/password.service.js';

describe('password service', () => {
  it('hashes with bcrypt at the configured cost and verifies the right password', async () => {
    const hash = await hashPassword('correct horse battery');

    expect(hash).toMatch(/^\$2[ab]\$04\$/); // cost 4 from the test environment
    expect(hash).not.toContain('correct horse battery');
    await expect(verifyPassword('correct horse battery', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery');
    await expect(verifyPassword('correct horse batterY', hash)).resolves.toBe(false);
  });

  it('salts: the same password hashes differently each time', async () => {
    expect(await hashPassword('same password!')).not.toBe(await hashPassword('same password!'));
  });

  it('counts bytes, not characters', () => {
    expect(passwordByteLength('abc')).toBe(3);
    expect(passwordByteLength('₹')).toBe(3);
  });

  it('accepts exactly 72 bytes', async () => {
    await expect(hashPassword('a'.repeat(MAX_PASSWORD_BYTES))).resolves.toMatch(/^\$2/);
    await expect(hashPassword('₹'.repeat(24))).resolves.toMatch(/^\$2/); // 24 chars, 72 bytes
  });

  it('rejects more than 72 bytes, including multi-byte passwords under 72 characters', async () => {
    await expect(hashPassword('a'.repeat(73))).rejects.toThrow(RangeError);
    await expect(hashPassword('₹'.repeat(25))).rejects.toThrow(RangeError); // 25 chars, 75 bytes
  });

  it('dummy verification always fails', async () => {
    await expect(verifyAgainstDummyHash('anything at all')).resolves.toBe(false);
    await expect(verifyAgainstDummyHash('')).resolves.toBe(false);
  });
});
