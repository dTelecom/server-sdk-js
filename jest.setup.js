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