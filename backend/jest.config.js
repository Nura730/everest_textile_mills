export default {
  testEnvironment: 'node',
  // ESM is handled natively (node --experimental-vm-modules); no Babel transform.
  transform: {},
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  globalSetup: '<rootDir>/tests/setup/globalSetup.js',
  globalTeardown: '<rootDir>/tests/setup/globalTeardown.js',
  // The first run downloads a mongod binary; later DB tests still need headroom.
  testTimeout: 30000,
  clearMocks: true,
  restoreMocks: true,
};
