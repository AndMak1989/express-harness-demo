module.exports = {
  testEnvironment: 'node',
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/server.js' // server.js is the listener, app.js contains the routes and logic
  ],
  coverageReporters: ['text', 'lcov', 'clover', 'cobertura'],
  testMatch: ['**/tests/**/*.test.js'],
  verbose: true
};
