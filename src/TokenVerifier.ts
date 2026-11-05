import crypto from 'crypto';
import bs58 from 'bs58';
import { createVerifier } from 'fast-jwt';

import type { ClaimGrants } from './grants.js';

// DER prefix of an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows it.
const ed25519SpkiPrefix = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

/** Verifies EdDSA tokens issued by a base58 Ed25519 public key, such as a node's key. */
export class TokenVerifier {
  private readonly verifyJwt: (token: string) => any;

  constructor(publicKey: string) {
    const publicKeyPem = crypto
      .createPublicKey({
        key: Buffer.concat([ed25519SpkiPrefix, Buffer.from(bs58.decode(publicKey))]),
        format: 'der',
        type: 'spki',
      })
      .export({ format: 'pem', type: 'spki' });

    this.verifyJwt = createVerifier({
      algorithms: ['EdDSA'],
      key: publicKeyPem as string,
      allowedIss: publicKey,
    });
  }

  verify(token: string): ClaimGrants {
    const decoded = this.verifyJwt(token);
    if (!decoded) {
      throw new Error('invalid token');
    }
    return decoded as ClaimGrants;
  }
}
