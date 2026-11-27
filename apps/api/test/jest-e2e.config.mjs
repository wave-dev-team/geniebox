import base from '../jest.config.mjs';

export default {
  ...base,
  rootDir: '..',
  testMatch: ['<rootDir>/test/integration/*.e2e-spec.ts'],
  globalSetup: '<rootDir>/test/support/setup.mjs',
  globalTeardown: '<rootDir>/test/support/teardown.mjs',
  setupFiles: ['<rootDir>/test/support/load-env.ts'],
  testTimeout: 30_000,
};
