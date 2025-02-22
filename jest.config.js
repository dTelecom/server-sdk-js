module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^node:(.*)$': '$1'
  },
  globals: {
    'ts-jest': {
      isolatedModules: true
    }
  },
  setupFiles: ['<rootDir>/jest.setup.js']
};
