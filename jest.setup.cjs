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
