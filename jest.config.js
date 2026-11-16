module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s', '!**/*.module.ts', '!**/main.ts', '!**/seed.ts', '!**/*.e2e-spec.ts'],
  coverageDirectory: '../coverage',
  // Floor of the current coverage: it may go up, never down. Raise these
  // values when coverage improves. Directory keys aggregate their files and
  // are excluded from the global numbers.
  coverageThreshold: {
    global: { statements: 37, branches: 32, functions: 24, lines: 36 },
    './src/modules/auth/': { statements: 78, branches: 71, functions: 50, lines: 79 },
    './src/modules/cash-register/': { statements: 37, branches: 37, functions: 22, lines: 36 },
    './src/modules/pos/': { statements: 88, branches: 77, functions: 51, lines: 89 },
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
};
