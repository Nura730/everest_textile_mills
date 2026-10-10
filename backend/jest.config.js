export default {
  testEnvironment: 'node',
  // ESM is handled natively (node --experimental-vm-modules); no Babel transform.
  transform: {},
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  clearMocks: true,
  restoreMocks: true,
};
