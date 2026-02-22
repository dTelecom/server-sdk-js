module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
      isolatedModules: true,
      diagnostics: {
        ignoreCodes: [151001]
      }
    }]
  },
  setupFiles: ['<rootDir>/jest.setup.cjs'],
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  moduleDirectories: ['node_modules'],
  transformIgnorePatterns: [
    'node_modules/(?!(@web3-core|web3|web3-utils|@noble|ethereum-cryptography)/)'
  ],
  extensionsToTreatAsEsm: ['.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node']
};
