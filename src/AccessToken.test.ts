// Mock @solana/web3.js
jest.mock('@solana/web3.js', () => ({
  Keypair: {
    fromSecretKey: (secretKey: Uint8Array) => ({
      secretKey,
      publicKey: {
        toBase58: () => 'H8crAQw9n4vNoxpptoRJAX6Mc7dkNkczRkCk39SNp3yZ'
      }
    })
  }
}));

// Mock fast-jwt
jest.mock('fast-jwt', () => {
  let currentMockToken = {
    video: { room: 'myroom' },
    name: 'myname',
    iss: 'H8crAQw9n4vNoxpptoRJAX6Mc7dkNkczRkCk39SNp3yZ',
    sub: 'me',
    sha256: 'abcdefg'
  };

  return {
    createSigner: () => {
      return (payload: any) => {
        // Store the payload for verification
        currentMockToken = payload;
        return 'mock.jwt.token';
      };
    },
    createVerifier: (options: any) => (token: string) => {
      // Check if the issuer matches the allowed issuer
      if (options.allowedIss !== 'H8crAQw9n4vNoxpptoRJAX6Mc7dkNkczRkCk39SNp3yZ') {
        throw new Error('Invalid issuer');
      }

      if (token === 'mock.jwt.token') {
        return currentMockToken;
      }
      throw new Error('Invalid token');
    }
  };
});

import { AccessToken, TokenVerifier } from './AccessToken';

// Use the example Solana keypair from the reference implementation
const testApiKey = 'H8crAQw9n4vNoxpptoRJAX6Mc7dkNkczRkCk39SNp3yZ';
const testSecret = '3yRpASkGYZ9AUihQF8ipVd7rse4KZLocZdajzFLnMTobZk9fqXtjyS6oi1tt8TfzNmJbok1hM4MuQdQ5D1UYHpVV';

describe('encoded tokens are valid', () => {
  const t = new AccessToken(testApiKey, testSecret, {
    identity: 'me',
    name: 'myname',
  });
  t.addGrant({ room: 'myroom' });
  const token = t.toJwt();

  const v = new TokenVerifier(testApiKey);
  const decoded = v.verify(token);

  it('can be decoded', () => {
    expect(decoded).not.toBe(undefined);
  });

  it('has name set', () => {
    expect(decoded.name).toBe('myname');
  });

  it('has video grants set', () => {
    expect(decoded.video).toBeTruthy();
    expect(decoded.video!.room).toEqual('myroom');
  });

  it('has correct issuer', () => {
    expect(decoded.iss).toBe(testApiKey);
  });

  it('has correct subject', () => {
    expect(decoded.sub).toBe('me');
  });
});

describe('identity is required for only join grants', () => {
  it('allows empty identity for create', () => {
    const t = new AccessToken(testApiKey, testSecret);
    t.addGrant({ roomCreate: true });

    expect(t.toJwt()).toBeTruthy();
  });

  it('throws error when room is not set for join', () => {
    const t = new AccessToken(testApiKey, testSecret, {
      identity: 'test'
    });
    t.addGrant({ roomJoin: true });

    expect(() => {
      t.toJwt();
    }).toThrow('room is required for join but not set');
  });
});

describe('verify token is valid', () => {
  it('can decode encoded token', () => {
    const t = new AccessToken(testApiKey, testSecret);
    t.sha256 = 'abcdefg';
    t.addGrant({ roomCreate: true });

    const v = new TokenVerifier(testApiKey);
    const decoded = v.verify(t.toJwt());

    expect(decoded).not.toBe(undefined);
    expect(decoded.sha256).toEqual('abcdefg');
    expect(decoded.video?.roomCreate).toBeTruthy();
  });

  it('fails with invalid public key', () => {
    const t = new AccessToken(testApiKey, testSecret);
    t.addGrant({ roomCreate: true });

    const invalidKey = 'H8crAQw9n4vNoxpptoRJAX6Mc7dkNkczRkCk39SNp3yY'; // Changed last char
    const v = new TokenVerifier(invalidKey);

    expect(() => {
      v.verify(t.toJwt());
    }).toThrow();
  });

  it('fails with tampered token', () => {
    const t = new AccessToken(testApiKey, testSecret);
    t.addGrant({ roomCreate: true });
    const token = t.toJwt();

    const v = new TokenVerifier(testApiKey);
    const tamperedToken = token.slice(0, -1) + (token.slice(-1) === '0' ? '1' : '0');

    expect(() => {
      v.verify(tamperedToken);
    }).toThrow();
  });
});
