/*
 * For a detailed explanation regarding each configuration property and type check, visit:
 * https://jestjs.io/docs/configuration
 */

export default {
  preset: "ts-jest",
  clearMocks: true,
  restoreMocks: true,
  testMatch: ["<rootDir>/test/**/*.test.ts"],
  testEnvironment: "node",
  setupFilesAfterEnv: ["<rootDir>/test/helpers/setup-jest.ts"],
  fakeTimers: {
    doNotFake: ["nextTick", "setImmediate", "clearImmediate"],
  },
};
