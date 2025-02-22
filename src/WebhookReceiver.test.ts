// Mock fast-jwt
jest.mock('fast-jwt', () => {
  let currentMockToken = {
    sha256: 'CoEQz1chqJ9bnZRcORddjplkvpjmPujmLTR42DbefYI=',
    iss: 'H8crAQw9n4vNoxpptoRJAX6Mc7dkNkczRkCk39SNp3yZ'
  };

  return {
    createSigner: () => {
      return (payload: any) => {
        currentMockToken = payload;
        return 'mock.jwt.token';
      };
    },
    createVerifier: (options: any) => (token: string) => {
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

import { AccessToken } from './AccessToken';
import { WebhookEvent } from './proto/livekit_webhook';
import { WebhookReceiver } from './WebhookReceiver';

// Use the example keypair from the reference implementation
const testApiKey = 'H8crAQw9n4vNoxpptoRJAX6Mc7dkNkczRkCk39SNp3yZ';
const testSecret = '3yRpASkGYZ9AUihQF8ipVd7rse4KZLocZdajzFLnMTobZk9fqXtjyS6oi1tt8TfzNmJbok1hM4MuQdQ5D1UYHpVV';

describe('webhook receiver', () => {
  const body =
    '{"event":"room_started", "room":{"sid":"RM_TkVjUvAqgzKz", "name":"mytestroom", "emptyTimeout":300, "creationTime":"1628545903", "turnPassword":"ICkSr2rEeslkN6e9bXL4Ji5zzMD5Z7zzr6ulOaxMj6N", "enabledCodecs":[{"mime":"audio/opus"}, {"mime":"video/VP8"}]}}';
  const sha = 'CoEQz1chqJ9bnZRcORddjplkvpjmPujmLTR42DbefYI=';
  const t = new AccessToken(testApiKey, testSecret);
  t.sha256 = sha;
  const token = t.toJwt();
  const receiver = new WebhookReceiver(testApiKey, testSecret);

  it('should receive and decode WebhookEvent', () => {
    const event = receiver.receive(body, token);
    expect(event).toBeTruthy();
    expect(event.room?.name).toBe('mytestroom');
    expect(event.event).toBe('room_started');
  });

  it('should fail with invalid token', () => {
    expect(() => {
      receiver.receive(body, 'invalid.token');
    }).toThrow();
  });

  it('should fail with mismatched sha256', () => {
    const t = new AccessToken(testApiKey, testSecret);
    t.sha256 = 'wrong-sha256';
    const wrongToken = t.toJwt();

    expect(() => {
      receiver.receive(body, wrongToken);
    }).toThrow('sha256 checksum of body does not match');
  });

  it('should fail without authorization header', () => {
    expect(() => {
      receiver.receive(body);
    }).toThrow('authorization header is empty');
  });

  it('should skip auth validation when skipAuth is true', () => {
    const event = receiver.receive(body, undefined, true);
    expect(event).toBeTruthy();
    expect(event.room?.name).toBe('mytestroom');
    expect(event.event).toBe('room_started');
  });
});

describe('decoding json payload', () => {
  it('should allow server to return extra fields', () => {
    const obj = {
      type: 'room_started',
      room: {
        sid: 'RM_TkVjUvAqgzKz',
        name: 'mytestroom',
      },
      extra: 'extra',
    };

    const event = WebhookEvent.fromJSON(obj);
    expect(event).toBeTruthy();
    expect(event.room?.name).toBe('mytestroom');
  });

  it('should handle missing fields', () => {
    const obj = {
      type: 'room_started',
      room: {
        sid: 'RM_TkVjUvAqgzKz'
      }
    };

    const event = WebhookEvent.fromJSON(obj);
    expect(event).toBeTruthy();
    expect(event.room?.sid).toBe('RM_TkVjUvAqgzKz');
    expect(event.room?.name).toBe('');
  });
});
