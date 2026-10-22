module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  coverageThreshold: { global: { branches: 75, functions: 80, lines: 80, statements: 80 } },
};
