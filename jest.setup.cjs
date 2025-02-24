const crypto = require('crypto');

// Mock crypto module for Ed25519 key operations used in JWT signing/verification
global.crypto = {
  ...crypto,
  createPrivateKey: (options) => ({
    export: () => '-----BEGIN PRIVATE KEY-----\nMock Private Key\n-----END PRIVATE KEY-----'
  }),
  createPublicKey: (options) => ({
    export: () => '-----BEGIN PUBLIC KEY-----\nMock Public Key\n-----END PUBLIC KEY-----'
  })
};

// Mock Solana environment
process.env.SOLANA_CONTRACT_ADDRESS = 'E2FcHsC9STeB6FEtxBKGAwMTX7cbfYMyjSHKs4QbBAmh';
process.env.SOLANA_NETWORK_HOST_HTTP = 'https://api.devnet.solana.com';
process.env.SOLANA_NETWORK_HOST_WS = 'wss://api.devnet.solana.com/';
process.env.SOLANA_REGISTRY_AUTHORITY = '9q4PdV3CrKDURNRSxPhBpzQJgQ9htSQeKQeB1PhR9umo';

// Mock @solana/web3.js
jest.mock('@solana/web3.js', () => {
  class MockPublicKey {
    constructor(value) {
      this.value = value;
    }

    toBytes() {
      return Buffer.from(this.value);
    }

    toBase58() {
      return this.value;
    }

    static findProgramAddress(seeds, programId) {
      return Promise.resolve([new MockPublicKey('mock-pda'), 0]);
    }
  }

  class MockConnection {
    constructor(endpoint) {
      this.endpoint = endpoint;
    }

    async getProgramAccounts(programId, config) {
      return [
        {
          pubkey: new MockPublicKey('mock-pubkey'),
          account: {
            data: Buffer.concat([
              Buffer.alloc(8), // discriminator
              Buffer.from('parent-key'.padEnd(32, '0')), // parent
              Buffer.from('registered-key'.padEnd(32, '0')), // registered
              Buffer.from([10, 0, 0, 0]), // domain length (10)
              Buffer.from('test.domain'.padEnd(10, ' ')), // domain
              Buffer.from([1, 0, 0, 0]), // online status
              Buffer.from([1]), // active status
              Buffer.alloc(253 - 10) // remaining space
            ])
          }
        }
      ];
    }

    async getAccountInfo(pubkey) {
      return {
        data: Buffer.concat([
          Buffer.alloc(8), // discriminator
          Buffer.from('parent-key'.padEnd(32, '0')), // parent
          Buffer.from('registered-key'.padEnd(32, '0')), // registered
          Buffer.from([10, 0, 0, 0]), // domain length (10)
          Buffer.from('test.domain'.padEnd(10, ' ')), // domain
          Buffer.from([1, 0, 0, 0]), // online status
          Buffer.from([1]), // active status
          Buffer.alloc(253 - 10) // remaining space
        ])
      };
    }
  }

  return {
    Connection: MockConnection,
    PublicKey: MockPublicKey
  };
}); 