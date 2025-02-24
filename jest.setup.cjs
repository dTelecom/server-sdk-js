const crypto = require('crypto');

// Mock crypto module
global.crypto = {
  ...crypto,
  createPrivateKey: (options) => ({
    export: () => '-----BEGIN PRIVATE KEY-----\nMock Private Key\n-----END PRIVATE KEY-----'
  }),
  createPublicKey: (options) => ({
    export: () => '-----BEGIN PUBLIC KEY-----\nMock Public Key\n-----END PUBLIC KEY-----'
  })
};

// Mock Web3 environment
process.env.WEB3_PROVIDER = 'http://localhost:8545';
process.env.CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000000';
process.env.WEB3_GAS_LIMIT = '30000000';

// Mock contract calls
jest.mock('web3', () => {
  const mockContract = {
    methods: {
      getAllNode: () => ({
        call: async () => [],
        estimateGas: async () => 21000
      }),
      nodeByAddress: () => ({
        call: async () => ({
          ip: '127.0.0.1',
          active: true,
          key: 'test-key'
        }),
        estimateGas: async () => 21000
      })
    }
  };

  class MockWeb3 {
    constructor() {
      this.eth = {
        Contract: jest.fn().mockImplementation(() => mockContract)
      };
    }
  }

  MockWeb3.providers = {
    HttpProvider: jest.fn()
  };

  return MockWeb3;
}); 